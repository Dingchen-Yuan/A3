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
    id: 'KM184866',
    salesOrder: '450188',
    outboundDelivery: '80004220',
    freightOrder: '61008640',
    customer: 'Mia Brooks',
    soldToParty: '1000388',
    channel: 'Home delivery',
    address: 'Parramatta NSW',
    promise: 'Mon 13 Oct, by 6pm',
    node: 'Moorebank fulfilment centre',
    items: [
      { sku: 'ANKO-TOWEL', name: 'ANKO Bath Towel', qty: 1, price: 16, damaged: false }
    ],
    events: [
      { at: 'Sun 12 Oct, 6:15pm', title: 'Order placed', state: 'done' },
      { at: 'Mon 13 Oct, 8:40am', title: 'Packed at the Moorebank fulfilment centre', state: 'done' },
      { at: 'Mon 13 Oct, 11:10am', title: 'Handed to the carrier', state: 'done' },
      { at: 'Tue 14 Oct, 4:00pm', title: 'Still on the way — a day past the promise', state: 'problem' }
    ],
    problem: {
      code: 'DELAY',
      title: 'This delivery is delayed',
      detail: 'It was promised by 6pm on Monday and it is still with the carrier. You can see where it is, then finish with a refund or a replacement.',
      foundAt: 'Tue 14 Oct, 4:00pm'
    },
    headline: 'Your towel is a day late',
    summary: 'Delivery delayed'
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
  DELAY: {
    code: 'DELAY',
    title: 'This delivery is delayed',
    detail: 'You told us this order is late. You can take a refund or a replacement.',
    foundAt: 'Reported just now'
  },
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
