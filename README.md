# Anko Mix-Lock

Deferred colour and size allocation for Kmart Anko. Buying commits total volume at Gate 1, then locks the variant mix once early sell-through is in, and writes that split back to SAP S/4HANA.

The app is a working buyer workflow: review the demand signal, adjust the suggested mix, confirm the lock, and keep an audit of the SAP request. Writes default to simulation because the sandbox is read-only. The payload is the same one a production S/4HANA system would accept.

## What it does

Anko lines are often committed as a single bulk quantity before colour and size demand is known. An even split across variants leaves slow sellers to be marked down and fast sellers to stock out.

Mix-Lock closes that gap:

1. Read the open purchase order and the committed quantity.
2. Weight each colour and size by three weeks of trial-store sell-through.
3. Propose a case-pack allocation that still adds up to the committed volume.
4. Let the buyer adjust the mix before it is locked.
5. Post variant lines onto the purchase order, or save that request locally in simulation.

## Workflow

| Step | Screen | Outcome |
| --- | --- | --- |
| 1 | Dashboard | Lines awaiting a lock, share already locked, and markdown exposure of an even split versus the suggested mix |
| 2 | Review signal | Purchase order, committed quantity, and sell-through by colour and size |
| 3 | Adjust mix | Suggested quantities, editable before confirmation, held to case packs |
| 4 | Confirm mix lock | Variant split sent through the SAP write adapter |
| — | History | Saved simulate and live write requests |

## Allocation rules

The suggestion in `public/allocation.js` follows four rules:

- Share committed units in proportion to the sell-through signal.
- Give every variant at least 5% of committed volume, rounded up to whole case packs (minimum one pack).
- Round each variant to the line’s case pack.
- Shift the remainder onto the largest variant so the total still equals the committed quantity.

`tests/allocation.test.js` prints a worked example for the knit throw (1,368 units, pack of 12), including markdown exposure before and after the suggested mix.

## SAP integration

Purchase orders are read from SAP with items expanded (`/PurchaseOrder/{number}?$expand=_PurchaseOrderItem`). A successful read is cached in `data/sap_cache.json` and reused if the sandbox is unavailable.

On confirm, the write adapter builds one purchase-order item per variant, starting at item 20, with plant `1710`, unit `PC`, and a schedule line. Two modes:

| `SAP_WRITE_MODE` | Behaviour |
| --- | --- |
| `simulate` (default) | Builds the S/4HANA request and stores it in `data/sap_write_store.json`. Nothing is posted. |
| `live` | Fetches a CSRF token, then posts each item to `/PurchaseOrder/{number}/_PurchaseOrderItem`. |

Lock state for the UI is kept in `data/app_state.json`.

## Run locally

Node.js 18 or later (the server uses the built-in `fetch`).

```bash
cd "INFOSYS704 A3"
node server.js
```

Open [http://localhost:3000](http://localhost:3000).

Optional `.env` in the same directory (this file is not committed):

```bash
SAP_BASE_URL=https://sandbox.api.sap.com/s4hanacloud/sap/opu/odata/sap/API_PURCHASEORDER_PROCESS_SRV
SAP_API_KEY=your-api-key
SAP_WRITE_MODE=simulate
PORT=3000
```

Environment variables override `.env`. Without a base URL and key, previously cached purchase orders still load and new locks stay in simulation.

Check the allocator:

```bash
node tests/allocation.test.js
```

Reset demo locks and the write history:

```bash
curl -X POST http://localhost:3000/api/reset-state
```

## HTTP API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/config` | Active write mode and SAP base URL |
| `GET` | `/api/lines` | Anko lines with SAP purchase-order data and lock status |
| `GET` | `/api/lines/:id` | One line |
| `GET` | `/api/po/:poNumber` | Purchase order, served from cache when SAP is unreachable |
| `POST` | `/api/mixlock` | Lock a mix. Body: `lineId`, `poNumber`, `finalSplit`, `note`, `committedQty` |
| `GET` | `/api/writes` | Saved SAP write requests |
| `GET` | `/api/writes/:id` | One write request |
| `POST` | `/api/reset-state` | Clear locks and write history |

## Layout

```
INFOSYS704 A3/
├── server.js                 HTTP server, SAP read, and write adapter
├── public/
│   ├── index.html            App shell
│   ├── styles.css
│   ├── app.js                Dashboard, review, adjust, confirm, history
│   └── allocation.js         Signal-weighted, case-pack allocation
├── data/
│   ├── mockLines.js          Anko lines and sell-through signals
│   ├── app_state.json        Which lines are mix-locked
│   ├── sap_cache.json        Cached purchase orders
│   └── sap_write_store.json  Saved write requests
└── tests/
    └── allocation.test.js    Worked allocation example
```

## Status

Working prototype for the Anko deferred-mix decision. The buyer path from dashboard to confirmed lock is usable end to end. SAP writes stay in simulation unless `SAP_WRITE_MODE=live` is set against a system that accepts purchase-order changes.
