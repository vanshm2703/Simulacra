# AGORA — Agent-based Governance and Outcome Response Analysis

> Simulate how economic policy cascades through society — from government decree to street-level life — in a living pixel-art city.

---

## Concept

Input a real-world economic policy (500–1000 words). AGORA spins up 20 AI agents representing every layer of society — government, corporations, small businesses, media, unions, NGOs, and households — and simulates 9 months of cascading reactions across three phases. Watch it unfold in a top-down pixel city: chat bubbles, protests, price spikes, hiring freezes, strikes.

**Target Prizes:**
- K2 Think V2 (Best Use) — K2 is the core reasoning engine, not a side call
- Societal Impact / ASUS — framing: tool for policymakers to stress-test decisions
- Best UI/UX — the visual sim is the differentiator

---

## Tech Stack

| Layer     | Tech                                      |
|-----------|-------------------------------------------|
| Frontend  | Phaser 3, Next.js, Bun                    |
| Backend   | FastAPI, LangGraph, Python                |
| LLM       | K2 Think V2 (via API) — primary reasoning |
| Assets    | Kenney RPG Urban Pack (CC0, 16×16 px)    |
| Map Tool  | Tiled Map Editor → JSON → Phaser Tilemap  |

**Tileset:** [Kenney RPG Urban Pack](https://kenney.nl/assets/rpg-urban-pack) — CC0, 480 tiles, 16×16, top-down city with buildings, roads, NPCs, vehicles. Direct download: `kenney_rpg-urban-pack.zip`

---

## Agent Roster

### Production (20 Agents)

#### Government Layer (2)
| ID | Name | Role |
|----|------|------|
| `gov_federal` | Federal Government | Enacts policy, controls fiscal levers |
| `gov_central_bank` | Central Bank | Controls monetary policy, interest rates |

#### Corporate Layer (7)
| ID | Name | Sector |
|----|------|--------|
| `corp_manufacturing` | NorthAm Manufacturing | Auto / Industrial |
| `corp_retail` | RetailGiant | Big-box retail |
| `corp_tech` | TechCo | Software / Hardware |
| `corp_energy` | EnergyCo | Utilities / Oil |
| `sme_shop` | Corner Shop | Small retail |
| `sme_restaurant` | Main St. Diner | Food service |
| `sme_contractor` | Local Contractor | Trades / Services |

#### Civil Society (3)
| ID | Name | Role |
|----|------|------|
| `media_outlet` | The Daily Pulse | News — shapes perception |
| `labor_union` | Workers United | Wage negotiation, strikes |
| `ngo_advocacy` | Community First | Housing / poverty advocacy |

#### Households (8)
| ID | Name | Bracket |
|----|------|---------|
| `hh_hnw_1` | The Castellanos | High net worth — investor |
| `hh_hnw_2` | The Hargroves | High net worth — executive |
| `hh_mc_1` | The Nguyens | Middle class — professional |
| `hh_mc_2` | The Petersons | Middle class — teacher |
| `hh_mc_3` | The Okafor family | Middle class — skilled worker |
| `hh_lm_1` | The Garcias | Lower-middle — service worker |
| `hh_poor_1` | The Washingtons | Low income — part-time |
| `hh_poor_2` | The Mirzas | Low income — gig / immigrant |

---

### Testing (10 Agents — subset)

`gov_federal`, `gov_central_bank`, `corp_manufacturing`, `corp_retail`, `sme_shop`, `media_outlet`, `labor_union`, `hh_hnw_1`, `hh_mc_1`, `hh_poor_1`

---

## Agent Attributes

### Base (all agents)
```python
id:                str       # unique slug
name:              str       # display name
agent_type:        str       # "government" | "central_bank" | "large_corp" | ...
sentiment:         float     # -1.0 (hostile/suffering) → 1.0 (thriving/content)
trust_government:  float     # 0.0 → 1.0
social_influence:  float     # 0.0 → 1.0  (weight on others' sentiment each cycle)
relationships:     dict      # {agent_id: float}  -1 (rival) → 1 (ally)
memory:            list[str] # ring buffer, last 10 events/messages received
```

### Economic Base (most agents)
```python
wealth:           float  # current assets ($)
monthly_income:   float
monthly_expenses: float
```

### Federal Government
```python
approval_rating:         float  # 0.0 → 1.0
tax_revenue_monthly:     float
public_budget_monthly:   float
deficit_monthly:         float
policy_stance:           str    # "expansionary" | "neutral" | "contractionary"
```

### Central Bank
```python
interest_rate:        float  # % (e.g. 5.25)
inflation_rate:       float  # current observed %
inflation_target:     float  # target % (default 2.0)
money_supply_growth:  float  # % YoY
monetary_stance:      str    # "dovish" | "neutral" | "hawkish"
```

### Large Corporation
```python
revenue_monthly:        float
profit_margin:          float  # %
employees:              int
sector:                 str
supply_chain_exposure:  float  # 0-1, how much policy affects input costs
price_pass_through:     float  # 0-1, ability to raise prices on consumers
lobbying_budget:        float
hiring_rate:            float  # % per month; negative = layoffs
```

### SME (Small/Medium Enterprise)
```python
revenue_monthly:   float
profit_margin:     float
employees:         int
sector:            str
debt_ratio:        float  # debt / assets
resilience:        float  # 0-1; if < 0.2 → closure event triggers
local_dependency:  float  # 0-1, tied to local consumer spending
```

### Media
```python
audience_reach:   float  # 0-1, fraction of agents reached per cycle
political_bias:   float  # -1.0 (progressive) → 1.0 (conservative)
credibility:      float  # 0-1; scales influence weight
ad_revenue:       float
```

### Labor Union
```python
membership:           int
negotiating_power:    float  # 0-1
current_wage_demand:  float  # % increase demanded this cycle
strike_probability:   float  # 0-1; if > 0.7 → strike event triggers
```

### NGO / Advocacy
```python
cause:              str    # "housing" | "poverty" | "environment"
public_support:     float  # 0-1
campaign_intensity: float  # 0-1
funding:            float
```

### Household
```python
income_bracket:      str    # "high" | "middle" | "lower_middle" | "poor"
annual_income:       float
dependents:          int
employment_status:   str    # "employed" | "unemployed" | "self_employed" | "retired"
employer_id:         str    # agent_id of employing corporation (if employed)
savings_rate:        float  # % of income saved monthly
debt_ratio:          float  # total debt / annual income
consumer_confidence: float  # 0-1
price_sensitivity:   float  # 0-1; high = spending cuts sharply when prices rise
```

---

## Simulation: Three-Phase Cascade (9 Months)

One full simulation = 9 simulated months across 3 phases.
Each phase = 3 months = 3 LangGraph cycles (1 cycle per simulated month).

---

### Phase 1 — Immediate Shock (Months 1–3)

**What happens:**
1. **Policy Ingestion** — K2 Think V2 parses the input policy text into structured parameters: affected sectors, cost impact %, timeline, enforcement mechanisms
2. **Government Broadcast** — `gov_federal` sends policy announcement to all agents
3. **Media Interpretation** — `media_outlet` filters through its `political_bias`, amplifies to its `audience_reach`; households and SMEs update `trust_government` and `sentiment`
4. **Corporate Threat Assessment** — each large corp computes `cost_delta = supply_chain_exposure × policy_cost_impact`; signals price adjustment intent
5. **Household Sentiment Shift** — households absorb news via media weight × credibility; `consumer_confidence` drops proportional to negative news
6. **Central Bank Hold** — `gov_central_bank` observes but holds rates; monitors inflation signal

**K2 role:** Interprets raw policy text → structured JSON parameters; generates each agent's first-person reaction message

**Outputs:** Initial sentiment map, price-intent signals, consumer confidence delta

---

### Phase 2 — Market Adjustment (Months 4–6)

**What happens:**
1. **Price Implementation** — corps execute price changes: `new_price_index += cost_delta × price_pass_through`
2. **Employment Shifts** — corps adjust `hiring_rate` based on margin squeeze; households with `employer_id = corp_X` update `employment_status` if layoff threshold crossed
3. **SME Squeeze** — SMEs face dual pressure: supplier cost increases + reduced consumer spending. `resilience -= stress_factor`; if `resilience < 0.2` → **closure event**
4. **Wage Negotiation** — `labor_union` escalates `current_wage_demand` proportional to inflation and layoff rate; corps accept or reject; if rejected, `strike_probability` rises
5. **Consumer Retrenchment** — households reduce spending based on `price_sensitivity × price_index_change`; lower income brackets feel more impact
6. **Monetary Response** — `gov_central_bank` adjusts `interest_rate` based on observed inflation signal; stance shifts

**K2 role:** Generates each agent's internal reasoning and outbound message per cycle; decides negotiation outcomes with multi-step reasoning

**Outputs:** Price index, unemployment delta, SME closures count, interest rate shift

---

### Phase 3 — Societal Cascade (Months 7–9)

**What happens:**
1. **Threshold Events** — accumulated stress triggers discrete events:
   - `strike_probability > 0.70` → **Strike event**: corps lose revenue, union gains power
   - `sme.resilience < 0.20` → **Business closure**: local unemployment spikes
   - `household.sentiment < -0.60` (3+ households) → **Protest event**: visible in city
   - `gov_federal.approval_rating < 0.30` → **Policy reversal signal**: government agent re-evaluates
2. **NGO Activation** — `ngo_advocacy` ramps `campaign_intensity` proportional to poverty indicators; generates public pressure on government
3. **Media Cascade** — media covers threshold events; `audience_reach` boosts for event cycles; feedback loop amplifies sentiment shifts
4. **Government Response** — `gov_federal` K2 reasoning considers approval_rating + NGO pressure + media tone → may issue policy amendments, relief packages, or double down
5. **Final Stabilization** — agents settle into new equilibrium

**K2 role:** Most critical phase — multi-agent reasoning chains; government counterfactual analysis; protest/strike outcome modeling

**Output Metrics Dashboard:**
| Metric | Description |
|--------|-------------|
| Price Index | Avg % price change across corps |
| Unemployment Rate | % of household agents unemployed |
| Social Unrest Index | Mean negative sentiment score |
| Business Survival Rate | % of SMEs still operating |
| Government Approval | `gov_federal.approval_rating` |
| Interest Rate | `gov_central_bank.interest_rate` |

---

## LangGraph Architecture

```
Policy Input
     ↓
[K2 Parser Node] → structured policy params
     ↓
[Orchestrator Node] — broadcasts to all agents
     ↓
┌────────────────────────────────────┐
│  Agent Subgraphs (parallel)        │
│  gov → bank → corps → sme →        │
│  media → union → ngo → households  │
└────────────────────────────────────┘
     ↓
[Aggregator Node] — collects messages, computes metrics
     ↓
[State Update Node] — updates all agent attributes
     ↓
[Event Check Node] — fires threshold events
     ↓
[Phase Gate] — next month or next phase
     ↓
[Dashboard Output] + [Frontend SSE Stream]
```

---

## Frontend: Pixel City

**Engine:** Phaser 3
**Tileset:** Kenney RPG Urban Pack (CC0) — roads, buildings, sidewalks, cars, NPCs
**Map:** Built in Tiled, exported as JSON

| Entity | Sprite | Behavior |
|--------|--------|----------|
| Households | Walking NPCs | Roam streets; protest when sentiment < -0.6 |
| SMEs | Storefront buildings | Door closes / "CLOSED" sign on closure event |
| Corps | Large office buildings | Hiring banner / layoff notice overlay |
| Government | City hall building | Flag color shifts with approval rating |
| Media | Billboard / broadcast tower | Flashes headlines |
| Union | Town square | Workers gather during strike event |
| Chat bubbles | Above any agent | Shows K2-generated reaction message |

**Event animations:**
- Protest: NPC sprites cluster at government building with placard sprites
- Strike: Workers gather outside factory, picketing
- Business closure: Storefront darkens, "CLOSED" overlay
- Price spike: $ counter floats up from shop

---

## Demo Script (90 seconds for judges)

1. Paste: *"The government imposes a 25% tariff on all imported steel and aluminum, effective immediately, with no exemptions."*
2. K2 parses → parameters appear on screen
3. Phase 1 plays: chat bubbles from corps ("Our input costs just jumped 25%"), households ("Prices are going up again...")
4. Phase 2: factory storefront flashes "LAYOFFS", Corner Shop sentiment goes red
5. Phase 3: NPCs cluster in protest, Corner Shop shows "CLOSED"
6. Dashboard shows: Price Index +18%, Unemployment +4.2%, Approval Rating -31%
7. Show counterfactual: replay with a subsidy policy → compare outcome

---

## Prize Positioning

| Prize | Argument |
|-------|----------|
| **K2 Think V2** | K2 is the entire reasoning backbone — every agent message, negotiation, event outcome, and policy parse runs through K2. Non-trivial multi-step simulation reasoning. |
| **Societal Impact** | Gives policymakers, journalists, and educators a tool to visualize second-order effects of economic decisions before they're enacted. |
| **Best UI/UX** | A living pixel city that reacts to policy in real time is not something judges have seen before. |
