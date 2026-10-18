// Fictional customer orders and delivery timelines for the prototype.
// Document ids illustrate SAP sales-order, outbound-delivery and freight-order
// references; they are not verified records from a connected SAP system.

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
  },
  {
    id: 'KM185104',
    salesOrder: '450252',
    outboundDelivery: '',
    freightOrder: '',
    customer: 'Olivia Wilson',
    soldToParty: '1000612',
    channel: 'Home delivery',
    address: 'Chatswood NSW',
    promise: 'Wed 21 Oct, by 8pm',
    node: 'Moorebank fulfilment centre',
    items: [
      { sku: 'ANKO-AIRFRY-35', name: 'ANKO Air Fryer 3.5L', qty: 1, price: 59, damaged: false },
      { sku: 'ANKO-TEATOWEL', name: 'ANKO Tea Towel', qty: 2, price: 6.50, damaged: false }
    ],
    events: [
      { at: 'Mon 19 Oct, 9:10am', title: 'Order placed — waiting to be packed', state: 'current' }
    ],
    problem: null,
    headline: 'Your kitchen essentials order is confirmed',
    summary: 'Order confirmed'
  },
  {
    id: 'KM185116',
    salesOrder: '450253',
    outboundDelivery: '80004563',
    freightOrder: '',
    customer: 'Ethan Nguyen',
    soldToParty: '1000623',
    channel: 'Home delivery',
    address: 'Geelong VIC',
    promise: 'Wed 21 Oct, by 8pm',
    node: 'Truganina fulfilment centre',
    items: [
      { sku: 'ANKO-QUILT-Q', name: 'ANKO Queen Quilt Cover Set', qty: 1, price: 35, damaged: false },
      { sku: 'ANKO-PILLOWCASE', name: 'ANKO Cotton Pillowcase', qty: 2, price: 8, damaged: false }
    ],
    events: [
      { at: 'Sun 18 Oct, 8:40pm', title: 'Order placed', state: 'done' },
      { at: 'Mon 19 Oct, 7:45am', title: 'Packed — awaiting carrier collection', state: 'current' }
    ],
    problem: null,
    headline: 'Your bedding is packed and awaiting the carrier',
    summary: 'Packed — awaiting carrier'
  },
  {
    id: 'KM185128',
    salesOrder: '450254',
    outboundDelivery: '80004564',
    freightOrder: '61008916',
    customer: 'Sofia Ahmed',
    soldToParty: '1000634',
    channel: 'Home delivery',
    address: 'Toowong QLD',
    promise: 'Tue 20 Oct, by 8pm',
    node: 'Moorebank fulfilment centre',
    items: [
      { sku: 'ANKO-CRATE', name: 'ANKO Foldable Storage Crate', qty: 2, price: 14, damaged: false },
      { sku: 'ANKO-LAUNDRY', name: 'ANKO Laundry Basket', qty: 1, price: 12, damaged: false }
    ],
    events: [
      { at: 'Sat 17 Oct, 2:25pm', title: 'Order placed', state: 'done' },
      { at: 'Sun 18 Oct, 10:15am', title: 'Packed at the Moorebank fulfilment centre', state: 'done' },
      { at: 'Sun 18 Oct, 4:30pm', title: 'Handed to the carrier', state: 'done' },
      { at: 'Mon 19 Oct, 6:20am', title: 'In transit to the Brisbane delivery depot', state: 'current' }
    ],
    problem: null,
    headline: 'Your storage essentials are on the way',
    summary: 'In transit'
  },
  {
    id: 'KM185140',
    salesOrder: '450255',
    outboundDelivery: '80004565',
    freightOrder: '61008917',
    customer: 'Lucas Johnson',
    soldToParty: '1000645',
    channel: 'Home delivery',
    address: 'Fitzroy VIC',
    promise: 'Sun 18 Oct, by 8pm',
    node: 'Truganina fulfilment centre',
    items: [
      { sku: 'ANKO-PLATE', name: 'ANKO Stoneware Dinner Plate', qty: 4, price: 4.50, damaged: false },
      { sku: 'ANKO-MUG', name: 'ANKO Ceramic Mug', qty: 2, price: 3, damaged: false }
    ],
    events: [
      { at: 'Fri 16 Oct, 5:05pm', title: 'Order placed', state: 'done' },
      { at: 'Sat 17 Oct, 9:30am', title: 'Packed at the Truganina fulfilment centre', state: 'done' },
      { at: 'Sun 18 Oct, 8:10am', title: 'Out for delivery', state: 'done' },
      { at: 'Sun 18 Oct, 2:18pm', title: 'Delivered to your nominated safe place', state: 'done' }
    ],
    problem: null,
    headline: 'Your dinnerware has been delivered',
    summary: 'Delivered'
  },
  {
    id: 'KM185152',
    salesOrder: '450256',
    outboundDelivery: '80004566',
    freightOrder: '61008918',
    customer: 'Charlotte Singh',
    soldToParty: '1000656',
    channel: 'Home delivery',
    address: 'Epping NSW',
    promise: 'Mon 19 Oct, by 6pm',
    node: 'Moorebank fulfilment centre',
    items: [
      { sku: 'ANKO-TOWEL', name: 'ANKO Bath Towel', qty: 3, price: 16, damaged: true },
      { sku: 'ANKO-HANDTOWEL', name: 'ANKO Hand Towel', qty: 2, price: 6, damaged: false }
    ],
    events: [
      { at: 'Sat 17 Oct, 11:35am', title: 'Order placed', state: 'done' },
      { at: 'Sun 18 Oct, 1:20pm', title: 'Packed at the Moorebank fulfilment centre', state: 'done' },
      { at: 'Mon 19 Oct, 7:55am', title: 'Out for delivery', state: 'done' },
      { at: 'Mon 19 Oct, 10:35am', title: 'Delivered — one bath towel damaged', state: 'problem' }
    ],
    problem: {
      code: 'DAMAGED',
      title: 'One of your bath towels arrived damaged',
      detail: 'One of the three bath towels is torn. The other two bath towels and both hand towels are fine. Only the damaged towel needs a replacement or refund.',
      foundAt: 'Mon 19 Oct, 10:35am',
      affectedItems: [{ itemId: 'line-1', qty: 1 }]
    },
    headline: 'One of your bath towels arrived damaged',
    summary: '1 item damaged'
  },
  {
    id: 'KM185164',
    salesOrder: '450257',
    outboundDelivery: '80004567',
    freightOrder: '61008919',
    customer: 'James Taylor',
    soldToParty: '1000667',
    channel: 'Home delivery',
    address: 'Brunswick VIC',
    promise: 'Mon 19 Oct, by 8pm',
    node: 'Truganina fulfilment centre',
    items: [
      { sku: 'ANKO-FOODCONT', name: 'ANKO Glass Food Container', qty: 2, price: 9, damaged: false },
      { sku: 'ANKO-BOTTLE', name: 'ANKO Water Bottle', qty: 2, price: 8, damaged: false },
      { sku: 'ANKO-LUNCHBAG', name: 'ANKO Lunch Bag', qty: 1, price: 12, damaged: false }
    ],
    events: [
      { at: 'Sat 17 Oct, 4:50pm', title: 'Order placed', state: 'done' },
      { at: 'Sun 18 Oct, 12:10pm', title: 'Packed at the Truganina fulfilment centre', state: 'done' },
      { at: 'Mon 19 Oct, 8:25am', title: 'Out for delivery', state: 'done' },
      { at: 'Mon 19 Oct, 11:20am', title: 'Delivered — one water bottle missing', state: 'problem' }
    ],
    problem: {
      code: 'MISSING',
      title: 'One water bottle is missing from your order',
      detail: 'The food containers, lunch bag and one water bottle arrived. The second water bottle is missing. Request a replacement or refund for that one unit; the rest of the order stays unchanged.',
      foundAt: 'Mon 19 Oct, 11:20am',
      affectedItems: [{ itemId: 'line-2', qty: 1 }]
    },
    headline: 'One water bottle is missing from your order',
    summary: '1 item missing'
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
