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
| `KM184920` | Knit throw out for delivery | A healthy order, plus “Something’s wrong” |

Ninety-second path: open `KM185002`, read the problem, keep the recommended replacement, check for an update until the case is ready, then confirm. The SAP service request is on the last screen.

```bash
node tests/recovery.test.js
```

Reset every demo case:

```bash
curl -X POST http://localhost:3000/api/reset
```

## SAP fit

Option 2. The API pool partly fits, so the wrapper and the customer surface changed. The business goal did not.

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

## What changed from the proposal

The proposal’s first build was the internal decision foundation, then basket-aware routing. Those stay later work: routing automation is high impact and high effort, and the API pool has no order-management routing service.

Delivery Assist is the high-impact step that the pool can support. The customer no longer pieces together a carrier page and a phone call. One Kmart journey covers the sales order, the delivery, the freight order and the service request.

The AS-IS customer path is a carrier status page, then the contact centre, then a separate refund. The TO-BE path is the six steps above, closed by one service request.

## Pitch

`pitch/Kmart-Delivery-Assist-Lab12.pptx` is the five-minute Managing Director pitch. Situation, complication and resolution come first. The groupwork disclaimer is the last slide. Add UPIs before upload, and confirm the contribution split with the group.
