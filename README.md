# Kmart Delivery Assist – Delivery Tracking & Recovery

INFOSYS 704 A3 prototype for Kmart Group (Wesfarmers). **Delivery Assist is the main strategic customer solution:** track an order, understand a delivery problem, choose a recovery and confirm the outcome. Supply Hub remains a secondary workspace for Anko buyers using the **SAP S/4HANA Cloud Purchase Order API (A2X, OData V4)**.

| Module | Business problem | Journey |
| --- | --- | --- |
| **Delivery Assist (main app)** | Customers lack one clear journey from a delivery problem to a confirmed recovery. | Track my order → Understand what is happening → Identify a delivery problem → Choose what to do → Track the recovery → Complete refund/replacement |
| **Recovery Management (staff)** | Requests need accountable review and evidence-backed operational updates. | Sign in → Review → Approve/decline → Record finance/fulfilment reference → Customer acknowledges |
| **Mix-Lock** | Anko commits the full colour/size mix ~9 months out; wrong guesses end up as markdowns. | Select line → Review signal → Adjust mix → Confirm mix lock |
| **Delivery Tracker** | Inbound delivery problems (late, short, damaged, rejected) are found late and handled by email. | Track → Understand → Identify problem → Choose action → Track recovery → Complete |

## Run it

Requires Node.js 18 or later. There are no npm dependencies.

```bash
cd "INFOSYS704 A3"
cp .env.example .env      # then paste your own SAP API key into .env
node server.js
```

Open <http://localhost:3000> for **Delivery Assist**. The **Supply Hub buyer workspace** is at <http://localhost:3000/supply-hub>. The earlier `/assist/index.html` address still works, and old buyer hash bookmarks such as `/#/deliveries` forward to Supply Hub.

**Recovery Management** is at <http://localhost:3000/recovery-management>. The local classroom staff code is **`INFOSYS_704`**. Click **Staff access code hint** on the sign-in page to reveal it, or click again to hide it. This deliberately public code is for demonstration convenience, not meaningful staff protection.

To use a private code, set a different `STAFF_ACCESS_KEY` in your git-ignored `.env` or environment. A privately configured code disables the public hint and is never returned by the hint endpoint or printed in server logs. Do not commit private credentials.

All experiences share the same left navigation: **Delivery Assist → Recovery Management → Mix-Lock → Delivery Tracker → History**. It stays visible above 640px (including the OpenCode preview); phones use the menu button, with Escape/backdrop closing and keyboard focus handling. Delivery Assist remains the main experience.

- **Without a SAP key**, the customer catalogue and staff-managed local workflow still work. SAP write requests remain in sandbox/simulation mode. Supply Hub reads POs from `data/sap_cache.json`.
- **With a key**, Supply Hub supports live SAP purchase-order reads and refreshes its snapshot. Delivery Assist can also query the sales-order API; the customer demo catalogue and timelines remain simulated.
- **Reset demo** in the buyer sidebar now resets **all four modules** after an explicit **Reset all demos** confirmation: Mix-Lock, Delivery Tracker, Delivery Assist and Recovery Management. It clears local locks, saved simulated SAP requests, customer problem reports, recovery cases, staff decisions and audit history. SAP snapshots, the staff code and current staff sign-ins are kept. Open pages on the same origin reload to discard stale cases and selections. The reset is blocked in live mode or if saved records contain live SAP writes; it never reverses external transactions. Individual customer reset endpoints still cannot erase staff-managed history.

## SAP integration

Base URL: `https://sandbox.api.sap.com/s4hanacloud/sap/opu/odata4/sap/api_purchaseorder_2/srvd_a2x/sap/purchaseorder/0001`

**Reads (live):**
- `GET /PurchaseOrder/{PO}?$expand=_PurchaseOrderItem` returns the header, items, committed quantity, plant, material and price.
- `GET /PurchaseOrder/{PO}?$expand=_PurchaseOrderItem($expand=_PurchaseOrderScheduleLineTP,_DeliveryAddress)` returns the delivery dates (current vs originally promised), open quantity, and the supplier-rejection and delivery-block flags.

**Writes:** the sandbox is read-only (POST returns `405 OPERATION_NOT_SUPPORTED`). So `SAP_WRITE_MODE=simulate` builds the exact OData V4 requests and stores them in `data/sap_write_store.json` instead of sending them. Users can inspect every request with **View SAP request**. Setting `live` sends them, with a CSRF token, to a real S/4HANA system.

| Action | SAP requests |
| --- | --- |
| Mix lock | `POST /PurchaseOrder/{PO}/_PurchaseOrderItem` per variant (plant, material, price and unit taken from the existing PO item; item numbers continue after the highest existing one) + `POST …/_PurchaseOrderNote` |
| Expedite / reschedule | `PATCH /PurchaseOrderScheduleLine/{PO}/{Item}/{SL}` (new `ScheduleLineDeliveryDate`) |
| Replacement | `POST` returns item (`IsReturnsItem: true`) + `POST` replacement item with schedule line |
| Refund / credit | `POST` returns item, or `PATCH` item quantity to the received quantity + `IsCompletelyDelivered` |
| Re-source / cancel | `PATCH` item `IsCompletelyDelivered` (+ `POST` re-sourced item) |
| Every recovery | `POST …/_PurchaseOrderNote` audit note |

## What is real and what is simulated

- **Real SAP data:**
  - purchase order headers, items, quantities, supplier IDs, plants and materials;
  - schedule-line dates and the rejection and block flags, when the sandbox returns them.
- **Simulated:**
  - **mix-lock:** trial-store sell-through (`data/mockLines.js`);
  - **delivery tracking:** carrier milestones, route and vessel (`data/deliveries.js`, labelled "Carrier feed (simulated)" in the UI), plus DC receipt and damage counts;
  - all write operations.

## Allocation rules (Mix-Lock)

`public/allocation.js`:
1. Share committed units in proportion to sell-through.
2. Give every variant at least 5% of committed volume.
3. Round to case packs.
4. Adjust the largest variant so the total equals the committed quantity exactly.

Run the worked example with `node tests/allocation.test.js`.

## Problem detection (Delivery Tracker)

| Problem | Rule |
| --- | --- |
| Delay | SAP `ScheduleLineDeliveryDate` is later than `SchedLineStscDeliveryDate`, or the carrier ETA is later than the promised date |
| Short delivery | DC receipt is less than the SAP `OrderQuantity` |
| Damage | Damaged cartons found at DC inbound inspection |
| Rejection / block | SAP `ItemIsRejectedBySupplier`, `PurgItemIsBlockedForDelivery` |

## Layout

```
INFOSYS704 A3/
├── server.js               HTTP server, SAP read + cache, write adapter, problem detection
├── .env.example            copy to .env (git-ignored)
├── public/
│   ├── index.html          buyer shell (served at /supply-hub)
│   ├── assist/             main customer app (served at /)
│   ├── staff/              authenticated Recovery Management workspace
│   ├── styles.css          design system
│   ├── app.js              all screens (hash routing)
│   ├── allocation.js       mix allocation maths
│   ├── assets/             put kmart-logo.png here
│   └── vendor/leaflet/     map library (bundled so it works without a CDN)
├── data/
│   ├── mockLines.js        Anko lines + sell-through signal
│   ├── deliveries.js       inbound shipments + simulated carrier feed
│   ├── sap_cache.json      last successful SAP reads
│   ├── sap_write_store.json, app_state.json, recovery_cases.json   demo state
└── tests/allocation.test.js
```

Map tiles © OpenStreetMap contributors. Leaflet is BSD-2-licensed (`public/vendor/leaflet/LICENSE`).

## Customer Delivery Assist

Delivery Assist is the default experience at [http://localhost:3000](http://localhost:3000). The inbound tracker and Mix-Lock remain separate buyer tools at `/supply-hub`; customer recovery does not read or write their state.

1. Track my order
2. Understand what is happening
3. Identify a delivery problem
4. Choose what to do
5. Track the recovery
6. Complete refund or replacement

| Order | What the customer sees | Use it to show |
| --- | --- | --- |
| `KM185002` | ANKO storage box delivered damaged | Replacement, or a refund of $18, not the whole $30 order |
| `KM184773` | Lamp delivery attempted, no one home | Request redelivery, a confirmed collection arrangement, or refund |
| `KM184866` | Bath towel a day past the promise | A delay, then a refund of $16 or a replacement |
| `KM184920` | Knit throw out for delivery | A healthy order, plus “Something’s wrong” |
| `KM185104` | Air fryer and tea towels, order confirmed | An order waiting to be packed; $72 total |
| `KM185116` | Quilt cover set and pillowcases, packed | Awaiting carrier collection; $51 total |
| `KM185128` | Storage crates and laundry basket, in transit | A multi-item shipment on its way; $40 total |
| `KM185140` | Dinner plates and mugs, delivered | A completed delivery that can still be reported as damaged/missing; $24 total |
| `KM185152` | One of three bath towels damaged | Replace/refund **1 towel for $16**, not the $60 order |
| `KM185164` | One of two water bottles missing | Replace/refund **1 bottle for $8**, not the $46 order |

These ten sample orders use fictional customer details and illustrative document references. They appear automatically under **Track my order**, can be found by order or sales-order number, and remain available after **Reset demo**. No staff decisions or recovery cases are pre-created for the new samples.

A delay finishes as a replacement or a refund. The service request uses `OP_API_SERVICE_REQUEST_SRV_0001`. `API_BILLING_DOCUMENT_REQUEST_SRV` is not used to create a refund. Sales orders are read with `API_SALES_ORDER_SRV`, `$top=5`, `$select` and `$expand=to_Item`, using the same `SAP_API_KEY`. The sandbox root is taken from `SAP_BASE_URL` by dropping the purchase-order path.

### SAP orders and amounts

- Sales-order numbers and customer references use one shared lookup. SAP orders receive stable internal IDs such as `SAP-990001`; the original sales-order number and customer reference remain searchable aliases.
- Successful reads save an order snapshot in the git-ignored `data/customer_state.json`. The same snapshot is used for reporting, recovery, reopening and the recent-orders list, including after a server restart or when SAP is unavailable. Lookups reuse that snapshot rather than automatically refreshing prices; its read time is shown under SAP connection details.
- Saved SAP snapshots survive server restarts. Staff-managed case history cannot be cleared from the customer interface. Older saved cases remain readable; active older cases can be taken into staff review without discarding their original progress or SAP request history.
- SAP `NetAmount` is a **line total**, not a unit price. Two units with `NetAmount=20.00` therefore total 20.00, not 40.00. Totals use integer minor-unit arithmetic, and the original transaction currency is kept in the UI and recovery request (including currencies with zero or three decimal places).
- Missing/invalid amounts, quantities or currencies are rejected instead of creating zero-valued refund orders. Ambiguous customer references require a sales-order number rather than selecting an arbitrary order.

### Recovery safeguards

- A case can only close after staff record an outcome or a declined decision, followed by explicit customer acknowledgement. Merely approving a refund does not mean it has been paid.
- Completing a closed case again returns the existing result without another request.
- Customer-state mutations are serialized within the Node server so concurrent clicks cannot create duplicate confirmed requests or overwrite another order's case.
- In `live` mode, missing credentials, SAP errors and timeouts return an error rather than silently switching to simulation. Failed creation saves no confirmed case; failed completion leaves the case ready to retry.
- Reporting another problem or choosing a different option cannot silently erase an existing case. Amounts, currency and selected quantities stay frozen.

### Staff review and read-only recovery tracking

- **Refresh status** uses `GET /api/assist/cases/{caseId}`. It reads the saved case without advancing steps, completing an outcome, updating the case timestamp, populating SAP caches or sending SAP requests.
- **Last updated** is the saved case's `updatedAt`; **Last checked** is the response-only `recoveryCheckedAt` timestamp from the latest successful read. Refresh failures keep the last displayed status and checked time and show a retryable error.
- Customer demo controls have been removed. The old `/advance` endpoint returns `410` and cannot progress a case.
- Staff must sign in, begin review, and approve or decline with a customer-visible reason. An approved case stays pending until staff record a reference and confirmation time; fulfilment arrangements also require a scheduled date.
- Every staff action records the signed-in operator, time, transition and notes. Internal notes are excluded from customer responses. Version checks reject stale or duplicate actions.
- Recorded references always have `source: staff_recorded` and `externallyVerified: false`. The UI says **Finance confirmation recorded** or **Fulfilment arrangement recorded**, not "bank-paid" or "carrier-verified".
- **Review the outcome** appears only after a recorded outcome/decision. Customer acknowledgement closes the request; a declined request creates no refund/fulfilment write.

For a presentation, use a customer tab and a signed-in staff tab. Submit a customer request; staff begin review, approve it, and record the relevant confirmation reference. Refresh the customer tab to see each recorded update, then acknowledge the resolution. Use sample references only in clearly identified test scenarios; entering a reference never processes or independently verifies an external transaction.

Staff access uses a shared local code, rate-limited sign-in, an eight-hour HttpOnly/SameSite session cookie, and server-side role checks. With the public classroom hint enabled, anyone can obtain a staff session: this is **demonstration role separation, not secure access control or Kmart SSO**. Do not use the public code with real customer/finance data. Production requires private credentials/SSO, individual roles, HTTPS, customer ownership checks, tamper-resistant storage, and verified finance/fulfilment integrations.

### Item-specific problems and partial recovery

- Step 3 lets customers confirm the problem type and select affected items/quantities for **damage** or **missing items**. Delay and failed-attempt reports apply to the whole delivery and say so explicitly.
- Items have snapshot-specific IDs (`line-1`, `line-2`, …), so two order lines with the same SKU can be selected separately. The server accepts only item IDs and quantities; it calculates values from the saved order, not client-supplied prices.
- Unknown/duplicate items, empty selections, non-positive or excessive quantities, and fractional counts of whole-unit items are rejected. Existing fractional-quantity lines can retain fractional quantities.
- Partial values are proportional to the authoritative line total and rounded once in the order currency: **2 of 3 units on a $1 line = $0.67**, while all 3 remain $1.00.
- The case freezes the selected item names, quantities, values and currency. Options, recovery tracking, confirmation and reopening all show that scope; unselected units/items are unchanged. Existing saved cases and the original $18 damaged-box demo remain supported.

For an order without an existing case, select **An item is missing**, choose the affected product/quantity, then request its refund or replacement. For `KM185002`, a missing **1 ANKO Cushion Cover** requests **$12**, not the box's $18 or whole order's $30. Existing active cases remain available for staff review; historical closed cases are retained read-only.

Refund/replacement confirmations are prototype outcomes, not actual payments or replacement dispatches. SAP amounts are the supplied net line amounts; this is not a tax, shipping or payment-settlement integration. Carrier-driven recovery updates remain a separate improvement.

### Website chat — Kmart Assist

Click **Need help?** at the bottom-right of Delivery Assist, Recovery Management or Supply Hub. The responsive chat box supports suggested questions, conversation history, optional saved-order context, safe links to the relevant screen, a new-chat button and Escape to close. It is read-only: it cannot submit recoveries, make staff decisions, send payments, book deliveries or change SAP data.

**Without an AI key**, it works as explicitly labelled **Guided help**, using local delivery/recovery guidance. This is not a generative AI response. For example, include `KM185164` and ask about its missing item to see the saved **1 of 2 bottles / $8** scope.

**To enable real AI replies**, add your own OpenAI API credentials to the git-ignored `INFOSYS704 A3/.env` (keep any existing SAP/staff settings), then restart the server:

```dotenv
OPENAI_API_KEY=your_private_api_key
OPENAI_MODEL=gpt-4.1-mini
```

The browser then displays **AI assistant · OpenAI**. The Node server calls the OpenAI Responses API; the key is never returned to browser code. API usage requires your own API access/billing. Provider failures show an error and retain the draft for retry, rather than displaying a scripted answer as AI.

- Order context is **opt-in** through **Include an order**, or **Use [current order]** while viewing an order. Only that saved order's status, product scope and amounts are included—no names, addresses, staff notes, finance/booking references, raw SAP requests or bulk catalogue. Unknown references do not trigger SAP lookups. Changing the included order starts a fresh conversation.
- With AI enabled, messages and the selected minimal context are sent to OpenAI. User-written messages are not automatically redacted: do not enter personal/payment details or credentials. Responses API requests use `store: false`; OpenAI's own data-handling policies still apply.
- Chats are held in page memory, not saved by this app. **New chat**, a page reload/workspace change or **Reset demo** clears them. Closing/reopening the panel on the same page retains the current conversation.
- Requests have input/history limits, a 15-second provider timeout, 15 messages per IP/minute, at most three concurrent AI requests and a 100-AI-request/hour process limit. Waiting for AI does not block order/staff updates.
- `GET /api/chat/config` reports the mode without credentials. `POST /api/chat` accepts only alternating user/assistant messages and an optional `orderRef`; it has no transaction/tool-calling capabilities. Replies are rendered as plain text, not executable HTML.
- Existing prototype customer/staff access rules are unchanged. An order reference is not identity verification. Keep this local; production needs authenticated customers/staff, ownership checks and deployment-level abuse/cost controls before exposing paid AI or real customer data.

### Tests

```bash
node tests/customerRecovery.test.js
node tests/customerOrders.test.js
node tests/customerAmounts.test.js
node tests/customerSelections.test.js
node tests/customerAssist.test.js
node tests/customerTracking.test.js
node tests/recoveryManagement.test.js
node tests/staffAccessHint.test.js
node tests/demoReset.test.js
node tests/navigation.test.js
node tests/websiteChat.test.js
```

Tests use in-memory state and mocked SAP/AI responses. They cover staff authentication, decision ordering, references/dates, private-note filtering, stale versions, rejection without a financial write, frozen amounts, SAP lookup, partial quantities and read-only customer refresh. Chat tests check minimal context, read-only state, honest mode labels, errors, rate limits and non-blocking model calls. The all-module reset test checks explicit confirmation, live-data guards, retained snapshots/sign-ins and earlier in-flight writes. HTTP tests use temporary local ports. None of these tests resets your saved case history, sends real SAP writes or spends AI credits.

Process models are in `design/`. The Lab 12 deck is `pitch/Kmart-Delivery-Assist-Lab12.pptx`. UPIs on the last slide still need to be filled in.
