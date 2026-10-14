const COLOURS = ['Black', 'Sage', 'Cream', 'Terracotta'];
const SIZES = ['100x150cm', '130x170cm', '150x200cm'];

// Weekly trial-store sell-through by colour/size. Values are units over 3 weeks.
function sig(rows) {
  return rows; // 4x3 matrix
}

const LINES = [
  {
    id: 'L001',
    name: 'ANKO Knit Throw AW27',
    category: 'Homewares',
    poNumber: '4500207755',
    unitPrice: 24.00,
    markdownPct: 0.40,
    casePack: 12,
    colours: COLOURS,
    sizes: SIZES,
    // 3 weeks of sell-through (rows colour, cols size)
    signal: [
      [420, 310, 180],
      [360, 440, 260],
      [290, 220, 150],
      [180, 140, 90]
    ]
  },
  {
    id: 'L002',
    name: 'ANKO Cushion Cover 45cm',
    category: 'Homewares',
    poNumber: '4500207702',
    unitPrice: 12.00,
    markdownPct: 0.35,
    casePack: 12,
    colours: COLOURS,
    sizes: SIZES,
    signal: [
      [180, 140, 100],
      [240, 280, 160],
      [120, 110, 80],
      [90, 70, 50]
    ]
  },
  {
    id: 'L003',
    name: 'ANKO Storage Box 30L',
    category: 'Storage',
    poNumber: '4500207758',
    unitPrice: 18.00,
    markdownPct: 0.30,
    casePack: 12,
    colours: COLOURS,
    sizes: ['S', 'M', 'L'],
    signal: [
      [160, 210, 140],
      [120, 180, 120],
      [90, 120, 80],
      [60, 80, 50]
    ]
  },
  {
    id: 'L004',
    name: 'ANKO LED Table Lamp',
    category: 'Lighting',
    poNumber: '4500207637',
    unitPrice: 32.00,
    markdownPct: 0.45,
    casePack: 12,
    colours: ['White', 'Black', 'Brass', 'Rose'],
    sizes: ['Small', 'Medium', 'Large'],
    signal: [
      [220, 180, 120],
      [150, 140, 90],
      [110, 95, 60],
      [80, 65, 40]
    ]
  },
  {
    id: 'L005',
    name: 'ANKO Area Rug 160x230',
    category: 'Flooring',
    poNumber: '4500207590',
    unitPrice: 45.00,
    markdownPct: 0.50,
    casePack: 12,
    colours: COLOURS,
    sizes: SIZES,
    signal: [
      [90, 70, 45],
      [120, 95, 60],
      [70, 55, 35],
      [45, 35, 25]
    ]
  },
  {
    id: 'L006',
    name: 'ANKO Duvet Cover Set',
    category: 'Bedding',
    poNumber: '4500207586',
    unitPrice: 38.00,
    markdownPct: 0.40,
    casePack: 12,
    colours: COLOURS,
    sizes: ['Single', 'Double', 'Queen'],
    signal: [
      [140, 110, 80],
      [180, 210, 150],
      [100, 90, 60],
      [70, 60, 40]
    ]
  }
];

module.exports = { LINES, COLOURS, SIZES };
