# Kmart Supply Hub – Anko Mix-Lock & Delivery Tracker

INFOSYS 704 A3 prototype for Kmart Group (Wesfarmers). This internal tool for Anko buyers runs on the **SAP S/4HANA Cloud Purchase Order API (A2X, OData V4)**.

| Module | Business problem | Journey |
| --- | --- | --- |
| **Mix-Lock** | Anko commits the full colour/size mix ~9 months out; wrong guesses end up as markdowns. | Select line → Review signal → Adjust mix → Confirm mix lock |
| **Delivery Tracker** | Inbound delivery problems (late, short, damaged, rejected) are found late and handled by email. | Track → Understand → Identify problem → Choose action → Track recovery → Complete |

## Run it

Requires Node.js 18 or later. There are no npm dependencies.

```bash
cd "INFOSYS704 A3"
cp .env.example .env      # then paste your own SAP API key into .env
node server.js
```

Open <http://localhost:3000>.

- **Without a key**, the app still runs. It reads POs from the saved snapshot in `data/sap_cache.json`, and the header shows "SAP · cached snapshot".
- **With a key**, reads are live from the SAP sandbox ("SAP sandbox · live"). Each successful read refreshes the snapshot.
- **Reset demo** (sidebar) clears all locks, recovery cases and saved SAP requests.

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
│   ├── index.html          app shell
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
