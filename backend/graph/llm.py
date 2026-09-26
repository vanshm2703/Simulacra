"""Shared LLM client factory using K2-Think-v2."""

from __future__ import annotations

import json
import logging
import re
from typing import Any, TypeVar

from langchain_openai import ChatOpenAI
from pydantic import BaseModel

from config import K2_API_KEY, K2_BASE_URL, K2_MODEL, LLM_ENABLE_THINKING, LLM_TIMEOUT

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)


def get_llm(max_tokens: int | None = None, **_kwargs: Any) -> ChatOpenAI:
    """Create a ChatOpenAI instance pointed at K2-Think-v2."""
    kwargs: dict[str, Any] = {
        "model": K2_MODEL, "api_key": K2_API_KEY, "base_url": K2_BASE_URL,
        "timeout": LLM_TIMEOUT, "max_retries": 0,
    }
    if not LLM_ENABLE_THINKING:
        kwargs["extra_body"] = {"chat_template_kwargs": {"enable_thinking": False}}
    if max_tokens is not None:
        kwargs["max_tokens"] = max_tokens
    return ChatOpenAI(**kwargs)  # pyright: ignore[reportCallIssue]


def strip_think_tags(content: str) -> str:
    """Remove K2 <think>...</think> reasoning blocks from raw model output.

    K2 sometimes omits the opening tag, emitting raw reasoning text up to </think>.
    Both forms are stripped so only the final answer remains.
    """
    content = re.sub(r"<think>.*?</think>", "", content, flags=re.DOTALL)
    content = re.sub(r"^.*?</think>", "", content, flags=re.DOTALL)
    return content.strip()


def _strip_trailing_commas(text: str) -> str:
    return re.sub(r",\s*([\]\}])", r"\1", text)


def _extract_json_from_response(content: str) -> Any:
    """Extract and parse JSON from LLM response (strips <think> tags and markdown fences).

    Returns the parsed Python object, or raises json.JSONDecodeError if nothing found.
    """
    original = content
    content = strip_think_tags(content)

    json_match = re.search(r"```(?:json)?\s*([\s\S]*?)```", content)
    if json_match:
        fence_content = json_match.group(1).strip()
        if fence_content:
            return json.loads(fence_content)

    def _balanced_json_slice(text: str, start: int) -> str | None:
        open_char = text[start]
        if open_char not in "[{":
            return None
        close_char = "}" if open_char == "{" else "]"
        stack: list[str] = [close_char]
        in_string = False
        escaped = False
        for i in range(start + 1, len(text)):
            ch = text[i]
            if in_string:
                if escaped:
                    escaped = False
                elif ch == "\\":
                    escaped = True
                elif ch == '"':
                    in_string = False
                continue
            if ch == '"':
                in_string = True
                continue
            if ch == "{":
                stack.append("}")
            elif ch == "[":
                stack.append("]")
            elif ch in "]}":
                if not stack or ch != stack[-1]:
                    return None
                stack.pop()
                if not stack:
                    return text[start : i + 1]
        return None

    def _scan(text: str) -> list[tuple[int, Any]]:
        results: list[tuple[int, Any]] = []
        for i, ch in enumerate(text):
            if ch not in "[{":
                continue
            candidate = _balanced_json_slice(text, i)
            if not candidate:
                continue
            try:
                results.append((i, json.loads(_strip_trailing_commas(candidate))))
            except json.JSONDecodeError:
                continue
        return results

    content = _strip_trailing_commas(content).strip()
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        pass

    # Scan right-to-left: K2 outputs reasoning first, actual JSON last.
    candidates = _scan(content)

    # K2 sometimes embeds JSON inside <think> blocks — fall back to scanning original.
    if not candidates:
        candidates = _scan(original)

    if candidates:
        # Prefer largest dict by serialized size (catches container dicts with list values
        # over small inner dicts that happen to have more keys)
        dicts = [v for _, v in candidates if isinstance(v, dict) and v]
        if dicts:
            return max(dicts, key=lambda d: len(json.dumps(d)))
        return candidates[-1][1]

    raise json.JSONDecodeError("No JSON found", content, 0)


def _unwrap_k2_array(parsed: Any) -> Any:
    """K2 sometimes wraps a single object in an array — return the first dict found."""
    if isinstance(parsed, list):
        return next((x for x in parsed if isinstance(x, dict)), {})
    return parsed


def _flatten_schema(schema: dict[str, Any]) -> dict[str, Any]:
    defs = schema.get("$defs", {})

    def _resolve(obj: Any) -> Any:
        if isinstance(obj, dict):
            if "$ref" in obj:
                ref_name = obj["$ref"].split("/")[-1]
                return _resolve(defs.get(ref_name, obj))
            return {k: _resolve(v) for k, v in obj.items() if k != "$defs"}
        if isinstance(obj, list):
            return [_resolve(item) for item in obj]
        return obj

    return _resolve({k: v for k, v in schema.items() if k != "$defs"})


def _schema_to_example(schema: dict[str, Any]) -> Any:
    """Build a concrete placeholder instance from a flattened JSON schema.

    Showing K2 an example instance (with placeholder values) is far more
    reliable than showing it the schema definition — K2 was echoing the schema
    object back as its answer instead of producing a filled instance.
    """
    t = schema.get("type")
    if t == "object":
        return {k: _schema_to_example(v) for k, v in schema.get("properties", {}).items()}
    if t == "array":
        return [_schema_to_example(schema.get("items", {}))]
    if t == "string":
        if "enum" in schema:
            return schema["enum"][0]
        return "..."
    if t in ("integer", "number"):
        return 0
    if t == "boolean":
        return True
    if "anyOf" in schema:
        non_null = [s for s in schema["anyOf"] if s.get("type") != "null"]
        return _schema_to_example(non_null[0]) if non_null else None
    return None


async def invoke_llm_structured(
    prompt: str,
    response_model: type[T],
    max_tokens: int = 4096,
    llm: ChatOpenAI | None = None,
    **_kwargs: Any,
) -> T:
    """Invoke K2 and parse the response into a Pydantic model.
    Retries up to 3 times — K2 occasionally outputs reasoning text with no JSON.
    """
    if llm is None:
        llm = get_llm(max_tokens=max_tokens)

    schema = _flatten_schema(response_model.model_json_schema())
    example = _schema_to_example(schema)
    augmented_prompt = (
        f"{prompt}\n\n"
        f"Output ONLY the following JSON with the placeholder values filled in. "
        f"No explanation, no reasoning, no other text — just the completed JSON:\n"
        f"{json.dumps(example, indent=2)}"
    )

    logger.info(
        "LLM structured call → %s (prompt %d chars)",
        response_model.__name__,
        len(augmented_prompt),
    )

    last_exc: Exception = RuntimeError("no attempts made")
    content = ""
    for attempt in range(1, 4):  # up to 3 attempts
        try:
            try:
                json_llm = llm.bind(response_format={"type": "json_object"})
                response = await json_llm.ainvoke(augmented_prompt)
            except Exception:
                response = await llm.ainvoke(augmented_prompt)

            content = response.content  # type: ignore[assignment]
            parsed = _unwrap_k2_array(_extract_json_from_response(content))
            result = response_model.model_validate(parsed)
            logger.info("LLM structured call ← %s OK", response_model.__name__)
            return result

        except Exception as exc:
            last_exc = exc
            if attempt < 3:
                logger.warning(
                    "LLM structured call attempt %d/3 failed for %s: %s — retrying",
                    attempt,
                    response_model.__name__,
                    exc,
                )
            else:
                logger.warning(
                    "Failed to parse response for %s: %s\nContent: %s",
                    response_model.__name__,
                    exc,
                    content[:300],
                )

    raise last_exc


async def invoke_llm_json(
    prompt: str,
    max_tokens: int = 4096,
    llm: ChatOpenAI | None = None,
    **_kwargs: Any,
) -> dict[str, Any]:
    """Invoke K2 and return the parsed JSON response as a dict.
    Retries up to 3 times — K2 occasionally outputs reasoning text with no JSON.
    """
    if llm is None:
        llm = get_llm(max_tokens=max_tokens)

    last_exc: Exception = RuntimeError("no attempts made")
    content = ""
    for attempt in range(1, 4):
        try:
            try:
                json_llm = llm.bind(response_format={"type": "json_object"})
                response = await json_llm.ainvoke(prompt)
            except Exception:
                response = await llm.ainvoke(prompt)

            content = response.content  # type: ignore[assignment]
            result = _unwrap_k2_array(_extract_json_from_response(content))
            return result

        except Exception as exc:
            last_exc = exc
            if attempt < 3:
                logger.warning(
                    "invoke_llm_json attempt %d/3 failed: %s — retrying",
                    attempt,
                    exc,
                )
            else:
                logger.warning(
                    "invoke_llm_json failed after 3 attempts: %s\nContent: %s",
                    exc,
                    content[:300],
                )

    raise last_exc
