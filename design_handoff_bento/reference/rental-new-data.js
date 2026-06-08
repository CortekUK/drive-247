// Data for the New Rental Agreement form (tenant: RevTek Rentals, Jacksonville).
window.RN_DATA = {
  tenant: { name: 'RevTek Rentals', code: 'RT', city: 'Jacksonville, FL', address: '932 Dunn Ave, Jacksonville, FL', currency: '$' },

  customers: [
    { id: 'c1', name: 'Marcus Webb',   email: 'm.webb@email.com',   phone: '+1 904 555 0142', age: 34, verified: 'Verified', rating: 4.9, rentals: 12, insuranceOnFile: true,  hue: 222 },
    { id: 'c2', name: 'Nina Park',      email: 'nina.park@email.com',phone: '+1 904 555 0188', age: 41, verified: 'Verified', rating: 4.9, rentals: 9,  insuranceOnFile: true,  hue: 12  },
    { id: 'c3', name: 'Aisha Bello',    email: 'a.bello@email.com',  phone: '+1 904 555 0203', age: 29, verified: 'Verified', rating: 5.0, rentals: 8,  insuranceOnFile: false, hue: 200 },
    { id: 'c4', name: 'Devon Clarke',   email: 'd.clarke@email.com', phone: '+1 904 555 0231', age: 27, verified: 'Pending',  rating: 0,   rentals: 1,  insuranceOnFile: false, hue: 96  },
    { id: 'c5', name: 'Lena Ortiz',     email: 'l.ortiz@email.com',  phone: '+1 904 555 0299', age: 38, verified: 'Verified', rating: 4.7, rentals: 5,  insuranceOnFile: true,  hue: 268 },
  ],

  vehicles: [
    { id: 'v1', make: 'Tesla',  model: 'Model 3', year: 2024, reg: 'EVX-1188', status: 'Available', daily: 89, weekly: 540, monthly: 1980, deposit: 350, mileage: 250, hue: 158 },
    { id: 'v2', make: 'BMW',    model: 'X3',      year: 2023, reg: 'BMX-2210', status: 'Available', daily: 95, weekly: 580, monthly: 2150, deposit: 400, mileage: 200, hue: 222 },
    { id: 'v3', make: 'Toyota', model: 'RAV4',   year: 2023, reg: 'GHN-7745', status: 'Available', daily: 64, weekly: 390, monthly: 1450, deposit: 250, mileage: 300, hue: 24  },
    { id: 'v4', make: 'Jeep',   model: 'Wrangler',year:2022, reg: 'WRG-5567', status: 'Available', daily: 78, weekly: 470, monthly: 1720, deposit: 300, mileage: 200, hue: 96  },
    { id: 'v5', make: 'Audi',   model: 'A4',      year: 2022, reg: 'RTP-8890', status: 'Booked',    daily: 82, weekly: 500, monthly: 1850, deposit: 350, mileage: 250, hue: 268 },
  ],

  extras: [
    { key: 'seat',     name: 'Child seat',        price: 12, icon: 'shield' },
    { key: 'gps',      name: 'GPS navigation',    price: 8,  icon: 'pin' },
    { key: 'driver',   name: 'Additional driver', price: 15, icon: 'userPlus' },
    { key: 'toll',     name: 'Toll pass',         price: 10, icon: 'card' },
    { key: 'roadside', name: 'Roadside+',         price: 9,  icon: 'wrench' },
    { key: 'ski',      name: 'Ski / bike rack',   price: 7,  icon: 'car' },
  ],

  coverage: [
    { key: 'cdw',  label: 'Collision Damage (CDW)',     price: 18.5 },
    { key: 'rcli', label: 'Rental Car Liability (RCLI)',price: 12 },
    { key: 'sli',  label: 'Supplemental Liability (SLI)',price: 9.5 },
    { key: 'pai',  label: 'Personal Accident (PAI)',    price: 6 },
  ],

  paymentModes: ['Collect now', 'Pre-authorize', 'Manual / cash'],
  installments: ['Pay in full', 'Weekly', 'Bi-weekly', 'Monthly'],
  deliveryMethods: ['In person', 'Lockbox'],

  sections: [
    { id: 'sec-customer',  icon: 'users',    label: 'Customer & Vehicle', req: true },
    { id: 'sec-period',    icon: 'calendar', label: 'Period & Pricing',   req: true },
    { id: 'sec-location',  icon: 'pin',      label: 'Pickup & Return',    req: true },
    { id: 'sec-insurance', icon: 'shield',   label: 'Insurance & ID',     req: false },
    { id: 'sec-extras',    icon: 'tag',      label: 'Extras',             req: false },
    { id: 'sec-drivers',   icon: 'userPlus', label: 'Additional drivers', req: false },
    { id: 'sec-mileage',   icon: 'gauge',    label: 'Mileage',            req: false },
    { id: 'sec-payment',   icon: 'receipt',  label: 'Deposit & Payment',  req: false },
    { id: 'sec-notes',     icon: 'file',     label: 'Notes & Agreement',  req: false },
  ],

  steps: [
    'Validating rental details',
    'Creating rental record',
    'Setting up insurance',
    'Configuring pricing & charges',
    'Sending agreement for signing',
    'Sending notifications',
    'Finalising rental',
  ],

  times: ['08:00','09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00'],
  taxRate: 0.0825,
  serviceFee: 4.99,
};
