"use client";

// MongoDB-backed live connection for the multiplayer "playable city".
//
// Replaces the SpacetimeDB SDK (SpacetimeDBProvider / useSpacetimeDB / useTable /
// useReducer) with a tiny WebSocket client to the FastAPI backend
// (`/city/ws`), which reads/writes MongoDB. The hook API mirrors the SDK's so
// `useStdbCity` and the role UI keep working unchanged.

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

// Default to the backend on the same machine that served this page, so other
// laptops on the LAN (http://<host-ip>:3000/city) reach the host's backend.
function wsUrl(): string {
  if (process.env.NEXT_PUBLIC_CITY_WS_URL) return process.env.NEXT_PUBLIC_CITY_WS_URL;
  const api = process.env.NEXT_PUBLIC_API_URL ?? `http://${window.location.hostname}:8000`;
  return `${api.replace(/^http/, "ws")}/city/ws`;
}

export const CITY_TOKEN_KEY = "simulacra_city_token";

/** Ask the backend to start a fresh match, then reload so every panel starts clean. */
export async function restartGame(call: (reducer: string, args: Row) => Promise<void>): Promise<void> {
  await call("restart_game", {});
  // Give the worker a moment to seed the new world before reloading.
  await new Promise((r) => setTimeout(r, 4000));
  window.location.reload();
}

type Row = Record<string, unknown>;
export type TableName =
  | "world"
  | "agent"
  | "relationship"
  | "sim_event"
  | "indicator"
  | "player"
  | "chat_message"
  | "crisis"
  | "deal";

interface Identity {
  toHexString(): string;
}

interface CityCtx {
  isActive: boolean;
  identity: Identity | null;
  token: string | null;
  tables: Partial<Record<TableName, Row[]>>;
  subscribeInsert: (table: TableName, fn: (row: Row) => void) => () => void;
  call: (reducer: string, args: Row) => Promise<void>;
}

const Ctx = createContext<CityCtx | null>(null);
const EMPTY: Row[] = [];

const identityOf = (hex: string): Identity => ({ toHexString: () => hex });

/** Convert wire rows to the shapes the old generated bindings produced. */
function adaptRows(table: TableName, rows: Row[]): Row[] {
  switch (table) {
    case "world":
      return rows.map((r) => {
        const ms = Number(r.roundDeadline);
        return { ...r, roundDeadline: { toDate: () => new Date(ms) } };
      });
    case "agent":
      return rows.map((r) => ({
        ...r,
        controlledBy: typeof r.controlledBy === "string" ? identityOf(r.controlledBy) : undefined,
      }));
    case "crisis":
    case "deal":
      return rows.map((r) => ({ ...r, id: BigInt(r.id as number) }));
    default:
      return rows;
  }
}

/** JSON can't carry bigint — send ids as numbers. */
function toWire(args: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(args)) out[k] = typeof v === "bigint" ? Number(v) : v;
  return out;
}

export function CityProvider({ children }: { children: ReactNode }) {
  const [isActive, setActive] = useState(false);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [tables, setTables] = useState<Partial<Record<TableName, Row[]>>>({});
  const wsRef = useRef<WebSocket | null>(null);
  const pending = useRef(new Map<number, { resolve: () => void; reject: (e: Error) => void }>());
  const listeners = useRef(new Map<TableName, Set<(row: Row) => void>>());
  const reqSeq = useRef(0);

  useEffect(() => {
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      const saved = window.localStorage.getItem(CITY_TOKEN_KEY);
      const base = wsUrl();
      const ws = new WebSocket(saved ? `${base}?token=${encodeURIComponent(saved)}` : base);
      wsRef.current = ws;

      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data as string);
        if (msg.type === "hello") {
          window.localStorage.setItem(CITY_TOKEN_KEY, msg.token);
          setToken(msg.token);
          setIdentity(identityOf(msg.identity));
          setActive(true);
        } else if (msg.type === "state") {
          const newEvents = adaptRows("sim_event", msg.sim_event ?? []);
          setTables((prev) => {
            const next: Partial<Record<TableName, Row[]>> = {};
            for (const t of [
              "world", "agent", "relationship", "indicator", "player", "chat_message", "crisis", "deal",
            ] as TableName[]) {
              next[t] = adaptRows(t, msg[t] ?? []);
            }
            // Events arrive incrementally; keep a bounded tail.
            next.sim_event = [...(prev.sim_event ?? []), ...newEvents].slice(-500);
            return next;
          });
          const fns = listeners.current.get("sim_event");
          if (fns) for (const row of newEvents) for (const fn of fns) fn(row);
        } else if (msg.type === "result") {
          const p = pending.current.get(msg.reqId);
          if (p) {
            pending.current.delete(msg.reqId);
            if (msg.error) p.reject(new Error(msg.error));
            else p.resolve();
          }
        }
      };
      ws.onclose = () => {
        setActive(false);
        for (const p of pending.current.values()) p.reject(new Error("disconnected"));
        pending.current.clear();
        if (!closed) retry = setTimeout(connect, 1500);
      };
    };

    connect();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      wsRef.current?.close();
    };
  }, []);

  const subscribeInsert = useCallback((table: TableName, fn: (row: Row) => void) => {
    let set = listeners.current.get(table);
    if (!set) {
      set = new Set();
      listeners.current.set(table, set);
    }
    set.add(fn);
    return () => {
      set?.delete(fn);
    };
  }, []);

  const call = useCallback((reducer: string, args: Row) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error("not connected"));
    const reqId = ++reqSeq.current;
    return new Promise<void>((resolve, reject) => {
      pending.current.set(reqId, { resolve, reject });
      ws.send(JSON.stringify({ type: "call", reqId, reducer, args: toWire(args) }));
    });
  }, []);

  return (
    <Ctx.Provider value={{ isActive, identity, token, tables, subscribeInsert, call }}>
      {children}
    </Ctx.Provider>
  );
}

function useCtx(): CityCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("CityProvider missing");
  return c;
}

/** Same fields the SpacetimeDB `useSpacetimeDB()` exposed. */
export function useCityConnection() {
  const { isActive, identity, token, call } = useCtx();
  return { isActive, identity, token, call };
}

/** `[rows, ready]`, with an optional `onInsert` callback for new rows. */
export function useTable(table: TableName, opts?: { onInsert?: (row: Row) => void }) {
  const { tables, subscribeInsert } = useCtx();
  const onInsertRef = useRef(opts?.onInsert);
  onInsertRef.current = opts?.onInsert;
  const hasOnInsert = opts?.onInsert != null;
  useEffect(() => {
    if (!hasOnInsert) return;
    return subscribeInsert(table, (row) => onInsertRef.current?.(row));
  }, [table, hasOnInsert, subscribeInsert]);
  const rows = tables[table];
  return [rows ?? EMPTY, rows !== undefined] as const;
}

/** Returns a caller for a named reducer: `(args) => Promise<void>`. */
export function useReducer<A extends Row>(reducer: string) {
  const { call } = useCtx();
  return useCallback((args: A) => call(reducer, args), [call, reducer]);
}
