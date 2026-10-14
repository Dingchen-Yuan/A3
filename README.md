# Kmart Delivery Assist

Customer delivery tracking and recovery for Kmart Group. A customer can see where an order is, understand a delay or a damaged delivery, choose what to do, follow the recovery, and finish a refund or replacement.

This is the approved prototype for the exception-recovery goal. The wider fulfilment programme in the consulting proposal stays in place. This app is the part a customer can use now.

## The journey

1. Track my order
2. Understand what is happening
3. Identify a delivery problem
4. Choose what to do
5. Track the recovery
6. Complete refund or replacement

Open an order that already has a problem, or report one from an order that is still on the way.

## Run

Node.js 18 or later.

```bash
node server.js
```

Open [http://localhost:3000](http://localhost:3000).

Demo orders:

| Order | What the customer sees | Use it to show |
| --- | --- | --- |
| `KM185002` | ANKO storage box delivered damaged | Replacement, or a refund of $18, not the whole $30 order |
| `KM184773` | Lamp delivery attempted, no one home | Redeliver, collect from Kmart Broadway, or refund |
| `KM184866` | Bath towel a day past the promise | A delay, then a refund of $16 or a replacement |
| `KM184920` | Knit throw out for delivery | A healthy order, plus “Something’s wrong” |

Ninety-second path: open `KM185002`, read the problem, keep the recommended replacement, check for an update until the case is ready, then confirm. The SAP service request is on the last screen.

```bash
node tests/recovery.test.js
```

Reset every demo case:

```bash
curl -X POST http://localhost:3000/api/reset
```

## What changed from A2

A2 selected P2, the decision-data foundation, with a weighted score of 4.50 against 4.10 for P1 routing. P1 stays behind shadow evidence. The API pool cannot build that foundation: it has no order-management routing service and no harmonised cost dictionary.

This prototype is therefore Option 3. The exception-recovery goal is unchanged. The surface is now the customer, because that is what the pool can run. The new models are:

- `design/A3_AS-IS_Customer_Exception.bpmn` — carrier page, phone call, separate refund queue
- `design/A3_TO-BE_Delivery_Assist.bpmn` — the six-step journey and one service request

## SAP fit

The read follows the API pool sheet: `API_SALES_ORDER_SRV` with `$top=5`, `$select` and `$expand=to_Item`. Open an order and the screen reports whether the sandbox returned rows. The lab API key has to be in `.env` before that read succeeds.

| Job | API | What the prototype does |
| --- | --- | --- |
| See the order | `API_SALES_ORDER_SRV` | Sales order on every screen |
| See the shipment | `API_OUTBOUND_DELIVERY_SRV` | Outbound delivery number and the journey |
| See the movement | `CE_FREIGHTORDER_0001` | Freight order and the delivery events |
| Open the case | `OP_API_SERVICE_REQUEST_SRV_0001` | Create, then complete, a service request |
| Take the money | `API_BILLING_DOCUMENT_REQUEST_SRV` | Not used to create a refund. That API can read, reject or delete a billing document. The refund is confirmed here and linked to the sales order. |

Without `SAP_BASE_URL` and `SAP_API_KEY`, reads use the prototype orders and writes are stored as the service-request body. Set `SAP_WRITE_MODE=live` to post that body. A numeric sales order that is not in the demo list is read from `API_SALES_ORDER_SRV` when those variables are set.

```bash
SAP_BASE_URL=https://sandbox.api.sap.com/s4hanacloud
SAP_API_KEY=your-key
SAP_WRITE_MODE=simulate
PORT=3000
```

## Pitch

`pitch/Kmart-Delivery-Assist-Lab12.pptx` is the five-minute Managing Director pitch. Situation, complication and resolution come first. The groupwork disclaimer is the last slide. Add UPIs before upload, and confirm the contribution split with the group.
