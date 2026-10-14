// Customer-facing catalogue for the prototype.
// Document ids match the SAP objects the API pool can actually read:
// API_SALES_ORDER_SRV, API_OUTBOUND_DELIVERY_SRV, CE_FREIGHTORDER_0001.

const ORDERS = [
  {
    id: 'KM185002',
    salesOrder: '450218',
    outboundDelivery: '80004418',
    freightOrder: '61008821',
    customer: 'Ava Chen',
    soldToParty: '1000234',
    channel: 'Home delivery',
    address: 'Broadway, Ultimo NSW',
    promise: 'Tue 14 Oct, by 12pm',
    node: 'Truganina fulfilment centre',
    items: [
      { sku: 'ANKO-BOX-30', name: 'ANKO Storage Box 30L', qty: 1, price: 18, damaged: true },
      { sku: 'ANKO-CUSH-45', name: 'ANKO Cushion Cover 45cm', qty: 1, price: 12, damaged: false }
    ],
    events: [
      { at: 'Mon 13 Oct, 8:12am', title: 'Order placed', state: 'done' },
      { at: 'Mon 13 Oct, 3:40pm', title: 'Packed at the Truganina fulfilment centre', state: 'done' },
      { at: 'Tue 14 Oct, 6:05am', title: 'Handed to the carrier', state: 'done' },
      { at: 'Tue 14 Oct, 11:05am', title: 'Delivered — carton damaged', state: 'problem' }
    ],
    problem: {
      code: 'DAMAGED',
      title: 'The storage box arrived damaged',
      detail: 'The driver recorded the carton as damaged at 11:05am. The cushion cover in this order is fine. You should not have to keep a broken box.',
      foundAt: 'Tue 14 Oct, 11:05am'
    },
    headline: 'Your storage box was delivered damaged',
    summary: 'Damaged on delivery'
  },
  {
    id: 'KM184773',
    salesOrder: '450196',
    outboundDelivery: '80004302',
    freightOrder: '61008714',
    customer: 'Liam Patel',
    soldToParty: '1000418',
    channel: 'Home delivery',
    address: 'Southbank VIC',
    promise: 'Mon 13 Oct, by 8pm',
    node: 'Moorebank fulfilment centre',
    items: [
      { sku: 'ANKO-LAMP', name: 'ANKO LED Table Lamp', qty: 1, price: 32, damaged: false }
    ],
    events: [
      { at: 'Sun 12 Oct, 7:02pm', title: 'Order placed', state: 'done' },
      { at: 'Mon 13 Oct, 9:18am', title: 'Packed at the Moorebank fulfilment centre', state: 'done' },
      { at: 'Mon 13 Oct, 1:02pm', title: 'Out for delivery', state: 'done' },
      { at: 'Mon 13 Oct, 2:14pm', title: 'Delivery attempted — no one home', state: 'problem' }
    ],
    problem: {
      code: 'FAILED_ATTEMPT',
      title: 'We could not leave the lamp',
      detail: 'The carrier tried at 2:14pm on Monday and no one was available to receive it. The lamp is back with the carrier. Nothing has been refunded.',
      foundAt: 'Mon 13 Oct, 2:14pm'
    },
    headline: 'We tried to deliver your lamp yesterday',
    summary: 'Delivery attempt failed'
  },
  {
    id: 'KM184920',
    salesOrder: '450241',
    outboundDelivery: '80004550',
    freightOrder: '61008902',
    customer: 'Noor Rahman',
    soldToParty: '1000577',
    channel: 'Home delivery',
    address: 'Richmond VIC',
    promise: 'Today, by 8pm',
    node: 'Truganina fulfilment centre',
    items: [
      { sku: 'ANKO-THROW', name: 'ANKO Knit Throw', qty: 1, price: 24, damaged: false }
    ],
    events: [
      { at: 'Tue 14 Oct, 7:46am', title: 'Order placed', state: 'done' },
      { at: 'Tue 14 Oct, 11:20am', title: 'Packed at the Truganina fulfilment centre', state: 'done' },
      { at: 'Tue 14 Oct, 2:05pm', title: 'Out for delivery', state: 'current' }
    ],
    problem: null,
    headline: 'Your knit throw is out for delivery',
    summary: 'Out for delivery'
  }
];

const REPORTABLE = {
  FAILED_ATTEMPT: {
    code: 'FAILED_ATTEMPT',
    title: 'It has not arrived',
    detail: 'You told us this order has not arrived. We will treat it as a missed delivery and let you choose the next step.',
    foundAt: 'Reported just now'
  },
  DAMAGED: {
    code: 'DAMAGED',
    title: 'Something arrived damaged',
    detail: 'You told us an item arrived damaged. You can ask for a replacement or a refund of that item.',
    foundAt: 'Reported just now'
  },
  MISSING: {
    code: 'MISSING',
    title: 'An item is missing',
    detail: 'You told us part of the order is missing. You can ask for the missing item to be sent, or a refund of that item.',
    foundAt: 'Reported just now'
  }
};

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

function allOrders() {
  return ORDERS.map(clone);
}

function findOrder(query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return null;
  const hit = ORDERS.find(o =>
    o.id.toLowerCase() === q ||
    o.salesOrder.toLowerCase() === q
  );
  return hit ? clone(hit) : null;
}

module.exports = { ORDERS, REPORTABLE, allOrders, findOrder, clone };
