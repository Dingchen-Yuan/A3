// Inbound Anko shipments for the Delivery Tracker.
//
// Each shipment is pinned to a real SAP sandbox purchase order + item (read live,
// cached fallback). SAP has no carrier tracking, so the route, milestones and
// carrier events below are a SIMULATED carrier feed. Dates are offsets in days
// from "today" so the demo always looks current.

const PLACES = {
  ningbo:      { name: 'Ningbo, China',         lat: 29.94,  lng: 121.88 },
  shenzhen:    { name: 'Shenzhen (Yantian), China', lat: 22.57, lng: 114.27 },
  chittagong:  { name: 'Chattogram, Bangladesh', lat: 22.33, lng: 91.80 },
  melbourne:   { name: 'Port of Melbourne',      lat: -37.83, lng: 144.91 },
  sydney:      { name: 'Port Botany, Sydney',    lat: -33.97, lng: 151.22 },
  brisbane:    { name: 'Port of Brisbane',       lat: -27.38, lng: 153.17 },
  auckland:    { name: 'Ports of Auckland',      lat: -36.84, lng: 174.78 },
  fremantle:   { name: 'Fremantle Port, Perth',  lat: -32.05, lng: 115.74 },
  dcMelbourne: { name: 'Kmart DC – Melbourne',   lat: -37.80, lng: 144.75 },
  dcSydney:    { name: 'Kmart DC – Sydney',      lat: -33.85, lng: 150.90 },
  dcBrisbane:  { name: 'Kmart DC – Brisbane',    lat: -27.55, lng: 152.95 },
  dcAuckland:  { name: 'Kmart DC – Auckland',    lat: -36.95, lng: 174.80 },
  dcPerth:     { name: 'Kmart DC – Perth',       lat: -31.95, lng: 115.95 }
};

// Sea lanes (rough waypoints so the line stays at sea).
const LANES = {
  'ningbo-melbourne':  [[29.94,121.88],[29.75,122.75],[28.5,123],[27,123.2],[23.5,125.8],[20.5,126],[10,131],[2,135],[-1,142],[-1.6,147],[-0.8,149.5],[-1.8,151.5],[-2.3,154.0],[-4.5,153.95],[-5.4,154.2],[-9,154.5],[-15,156],[-28,155.5],[-36.5,151.2],[-38.3,150.6],[-39.6,147.5],[-39.3,145.2],[-38.45,144.6],[-38.2,144.8],[-37.83,144.91]],
  'shenzhen-sydney':   [[22.57,114.27],[21.0,118],[20.4,121.5],[14,127],[3,133.5],[-1,142],[-1.6,147],[-0.8,149.5],[-1.8,151.5],[-2.3,154.0],[-4.5,153.95],[-5.4,154.2],[-9,154.5],[-18,156],[-30,154.5],[-33.6,152.2],[-34.02,151.35],[-33.97,151.22]],
  'ningbo-auckland':   [[29.94,121.88],[29.75,122.75],[28.5,123],[27,123.2],[23.5,125.8],[20.5,126],[10,133],[1,143],[-1.2,150],[-3,155],[-5,160],[-8.5,163.5],[-12,171],[-25,174],[-34.5,175.5],[-36.3,175.0],[-36.84,174.78]],
  'shenzhen-brisbane': [[22.57,114.27],[21.0,118],[20.4,121.5],[14,127],[3,133.5],[-1,142],[-1.6,147],[-0.8,149.5],[-1.8,151.5],[-2.3,154.0],[-4.5,153.95],[-5.4,154.2],[-9,154.5],[-16,156.5],[-26,154.2],[-27.38,153.17]],
  'chittagong-fremantle': [[22.33,91.80],[18,90],[10,92.5],[6.2,95.5],[4.8,98.5],[2.6,101.2],[1.8,102.5],[1.15,103.55],[1.18,103.95],[1.25,104.3],[1.0,104.5],[0,105.5],[-2,109],[-5.8,112],[-8.75,115.85],[-14,114],[-24,112.5],[-32.05,115.74]]
};

const SHIPMENTS = [
  {
    id: 'S001',
    product: 'ANKO Knit Throw AW27',
    category: 'Homewares',
    poNumber: '4500207755', poItem: '1',
    supplierName: 'Ningbo Homeware Textiles Co.',
    origin: 'ningbo', portLoad: 'ningbo', portDischarge: 'melbourne', dc: 'dcMelbourne', lane: 'ningbo-melbourne',
    vessel: 'MSC Aurora V.412S', container: 'MSKU 7731402',
    unitCost: 9.80, unitsPerCarton: 12, storesAffected: 134, launchInDays: 12,
    // carrier milestones: [label, plannedOffsetDays, actualOffsetDays|null, place]
    milestones: [
      ['Supplier dispatched', -24, -24, 'ningbo'],
      ['Loaded at port', -21, -14, 'ningbo'],
      ['In transit (sea)', -20, -13, null],
      ['Arrived at port of discharge', 2, null, 'melbourne'],
      ['Received at Kmart DC', 5, null, 'dcMelbourne'],
      ['Allocated to stores', 8, null, null]
    ],
    etaOffset: 14, promisedOffset: 5, progress: 0.62,
    feed: { event: 'Vessel rollover at Ningbo – container missed original sailing (port congestion).', damagedCartons: 0, receivedQty: null, supplierResponse: 'confirmed' }
  },
  {
    id: 'S002',
    product: 'ANKO Cushion Cover 45cm',
    category: 'Homewares',
    poNumber: '4500207702', poItem: '1',
    supplierName: 'Shenzhen Soft Furnishings Ltd',
    origin: 'shenzhen', portLoad: 'shenzhen', portDischarge: 'sydney', dc: 'dcSydney', lane: 'shenzhen-sydney',
    vessel: 'ONE Harmony V.088S', container: 'ONEU 2290115',
    unitCost: 4.20, unitsPerCarton: 24, storesAffected: 96, launchInDays: 6,
    milestones: [
      ['Supplier dispatched', -26, -26, 'shenzhen'],
      ['Loaded at port', -23, -23, 'shenzhen'],
      ['In transit (sea)', -22, -22, null],
      ['Arrived at port of discharge', -6, -6, 'sydney'],
      ['Received at Kmart DC', -3, -3, 'dcSydney'],
      ['Allocated to stores', 1, null, null]
    ],
    etaOffset: -3, promisedOffset: -3, progress: 1,
    feed: { event: 'DC goods receipt counted fewer cartons than the advance shipping notice.', damagedCartons: 0, receivedRatio: 0.8, supplierResponse: 'confirmed' }
  },
  {
    id: 'S003',
    product: 'ANKO Storage Box 30L',
    category: 'Storage',
    poNumber: '4500207758', poItem: '1',
    supplierName: 'Zhejiang Plastics Manufacturing',
    origin: 'ningbo', portLoad: 'ningbo', portDischarge: 'auckland', dc: 'dcAuckland', lane: 'ningbo-auckland',
    vessel: 'Maersk Tauranga V.219S', container: 'MRKU 5518820',
    unitCost: 6.10, unitsPerCarton: 6, storesAffected: 27, launchInDays: 9,
    milestones: [
      ['Supplier dispatched', -30, -30, 'ningbo'],
      ['Loaded at port', -27, -27, 'ningbo'],
      ['In transit (sea)', -26, -26, null],
      ['Arrived at port of discharge', -4, -4, 'auckland'],
      ['Received at Kmart DC', -2, -2, 'dcAuckland'],
      ['Allocated to stores', 2, null, null]
    ],
    etaOffset: -2, promisedOffset: -2, progress: 1,
    feed: { event: 'Crushed cartons found at DC inbound inspection – lids cracked.', damagedCartons: 4, receivedQty: null, supplierResponse: 'confirmed' }
  },
  {
    id: 'S004',
    product: 'ANKO LED Table Lamp',
    category: 'Lighting',
    poNumber: '4500207637', poItem: '1',
    supplierName: 'Guangdong Lighting Co.',
    origin: 'shenzhen', portLoad: 'shenzhen', portDischarge: 'brisbane', dc: 'dcBrisbane', lane: 'shenzhen-brisbane',
    vessel: 'Not yet booked', container: '—',
    unitCost: 11.50, unitsPerCarton: 4, storesAffected: 58, launchInDays: 30,
    milestones: [
      ['Supplier dispatched', -2, null, 'shenzhen'],
      ['Loaded at port', 1, null, 'shenzhen'],
      ['In transit (sea)', 2, null, null],
      ['Arrived at port of discharge', 18, null, 'brisbane'],
      ['Received at Kmart DC', 21, null, 'dcBrisbane'],
      ['Allocated to stores', 24, null, null]
    ],
    etaOffset: 21, promisedOffset: 21, progress: 0,
    feed: { event: 'Supplier rejected the order line – failed electrical safety re-certification.', damagedCartons: 0, receivedQty: null, supplierResponse: 'rejected' }
  },
  {
    id: 'S005',
    product: 'ANKO Area Rug 160x230',
    category: 'Flooring',
    poNumber: '4500207590', poItem: '1',
    supplierName: 'Bengal Weaves Ltd',
    origin: 'chittagong', portLoad: 'chittagong', portDischarge: 'fremantle', dc: 'dcPerth', lane: 'chittagong-fremantle',
    vessel: 'CMA CGM Indus V.31E', container: 'CMAU 4410937',
    unitCost: 21.00, unitsPerCarton: 2, storesAffected: 22, launchInDays: 20,
    milestones: [
      ['Supplier dispatched', -14, -14, 'chittagong'],
      ['Loaded at port', -11, -11, 'chittagong'],
      ['In transit (sea)', -10, -10, null],
      ['Arrived at port of discharge', 6, null, 'fremantle'],
      ['Received at Kmart DC', 9, null, 'dcPerth'],
      ['Allocated to stores', 12, null, null]
    ],
    etaOffset: 9, promisedOffset: 9, progress: 0.58,
    feed: { event: 'On schedule.', damagedCartons: 0, receivedQty: null, supplierResponse: 'confirmed' }
  },
  {
    id: 'S006',
    product: 'ANKO Duvet Cover Set',
    category: 'Bedding',
    poNumber: '4500207586', poItem: '1',
    supplierName: 'Ningbo Homeware Textiles Co.',
    origin: 'ningbo', portLoad: 'ningbo', portDischarge: 'melbourne', dc: 'dcMelbourne', lane: 'ningbo-melbourne',
    vessel: 'MSC Aurora V.410S', container: 'MSCU 6620174',
    unitCost: 13.40, unitsPerCarton: 8, storesAffected: 134, launchInDays: 15,
    milestones: [
      ['Supplier dispatched', -20, -20, 'ningbo'],
      ['Loaded at port', -17, -17, 'ningbo'],
      ['In transit (sea)', -16, -16, null],
      ['Arrived at port of discharge', 4, null, 'melbourne'],
      ['Received at Kmart DC', 7, null, 'dcMelbourne'],
      ['Allocated to stores', 10, null, null]
    ],
    etaOffset: 7, promisedOffset: 7, progress: 0.78,
    feed: { event: 'On schedule.', damagedCartons: 0, receivedQty: null, supplierResponse: 'confirmed' }
  }
];

module.exports = { SHIPMENTS, PLACES, LANES };
