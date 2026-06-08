// Rental-company admin (tenant portal) mock data — tenant: DB Car Rentals, Miami.
// Authentic to the portal codebase: KPIs (overdue / due-today / active / fines /
// monthly revenue / fleet utilization), rentals with paid+balance, fleet, customers.

window.RA_DATA = (function () {
  const kpis = {
    monthlyRevenue: 48200, revenueDelta: '+9%',
    activeRentals: 168, activeDelta: '+12',
    fleet: { total: 42, rented: 33, available: 7, maintenance: 2, pct: 78 },
    overdue: { count: 4, amount: 3240 },
    dueToday: { returns: 7, pickups: 3, amount: 2100 },
    fines: { count: 5, amount: 890, dueSoon: 2 },
    customers: 1210, newCustomers: 38,
  };

  const revTrend = [31, 28, 34, 41, 38, 30, 44, 47, 39, 52, 48, 55];
  const revLabels = ['', '', '', '', '', '', '', '', '', '', '', ''];

  const schedule = [
    { time: '09:00', type: 'Pickup', who: 'Devon Clarke',  car: 'Tesla Model 3',  plate: 'EVX-1188' },
    { time: '10:30', type: 'Return', who: 'Priya Nair',    car: 'Toyota RAV4',    plate: 'GHN-7745' },
    { time: '13:00', type: 'Pickup', who: 'Nina Park',     car: 'Porsche Macan',  plate: 'MCN-9004' },
    { time: '15:30', type: 'Return', who: 'Sam Whitfield', car: 'Ford Bronco',    plate: 'BRC-3320' },
    { time: '17:00', type: 'Pickup', who: 'Ava Lindgren',  car: 'BMW X3',         plate: 'BMX-2210' },
  ];

  const activity = [
    { who: 'Aisha Bello',   what: 'paid $850 balance',            when: '6m ago',  kind: 'pay'    },
    { who: 'Nina Park',     what: 'booked Porsche Macan · 5 days',when: '24m ago', kind: 'book'   },
    { who: 'Lena Ortiz',    what: 'insurance verified',           when: '1h ago',  kind: 'insure' },
    { who: 'Carlos Mendez', what: 'rental is overdue',            when: '2h ago',  kind: 'overdue'},
    { who: 'Marcus Webb',   what: 'signed rental agreement',      when: '3h ago',  kind: 'sign'   },
  ];

  const actions = [
    { label: 'Insurance verifications pending', count: 2, tone: 'info' },
    { label: 'Rentals overdue — follow up',     count: 4, tone: 'danger' },
    { label: 'Unpaid fines · $890',             count: 5, tone: 'warning' },
    { label: 'Agreements awaiting signature',   count: 3, tone: 'info' },
  ];

  const rentals = [
    { customer: 'Marcus Webb',   car: 'BMW X5 2023',        plate: 'JKL-2241', from: 'Jun 1',  to: 'Jun 5',  days: 4, total: 1240, paid: 1240, status: 'Active',    insured: true  },
    { customer: 'Lena Ortiz',    car: 'Audi A4 2022',       plate: 'RTP-8890', from: 'Jun 2',  to: 'Jun 9',  days: 7, total: 1610, paid: 800,  status: 'Active',    insured: true  },
    { customer: 'Aisha Bello',   car: 'Mercedes EQE 2024',  plate: 'EQE-0091', from: 'Jun 3',  to: 'Jun 8',  days: 5, total: 1850, paid: 1850, status: 'Active',    insured: true  },
    { customer: 'Devon Clarke',  car: 'Tesla Model 3 2024', plate: 'EVX-1188', from: 'Jun 4',  to: 'Jun 6',  days: 2, total: 560,  paid: 0,    status: 'Upcoming',  insured: false },
    { customer: 'Nina Park',     car: 'Porsche Macan 2023', plate: 'MCN-9004', from: 'Jun 5',  to: 'Jun 10', days: 5, total: 2100, paid: 2100, status: 'Upcoming',  insured: true  },
    { customer: 'Carlos Mendez', car: 'Chevy Malibu 2023',  plate: 'MLB-1029', from: 'May 20', to: 'May 25', days: 5, total: 750,  paid: 300,  status: 'Overdue',   insured: true  },
    { customer: 'Priya Nair',    car: 'Toyota RAV4 2023',   plate: 'GHN-7745', from: 'May 28', to: 'Jun 2',  days: 5, total: 900,  paid: 900,  status: 'Completed', insured: true  },
    { customer: 'Sam Whitfield', car: 'Ford Bronco 2023',   plate: 'BRC-3320', from: 'May 30', to: 'Jun 3',  days: 4, total: 1080, paid: 1080, status: 'Completed', insured: true  },
  ];

  const fleet = [
    { make: 'BMW',      model: 'X5',        year: 2023, plate: 'JKL-2241', status: 'On rental',   rate: 310, util: 86, next: 'Returns Jun 5',  hue: 222 },
    { make: 'Mercedes', model: 'EQE',       year: 2024, plate: 'EQE-0091', status: 'On rental',   rate: 370, util: 92, next: 'Returns Jun 8',  hue: 200 },
    { make: 'Porsche',  model: 'Macan',     year: 2023, plate: 'MCN-9004', status: 'On rental',   rate: 420, util: 78, next: 'Returns Jun 10', hue: 12  },
    { make: 'Tesla',    model: 'Model 3',   year: 2024, plate: 'EVX-1188', status: 'Available',   rate: 280, util: 64, next: 'Picks up 09:00', hue: 158 },
    { make: 'Audi',     model: 'A4',        year: 2022, plate: 'RTP-8890', status: 'On rental',   rate: 230, util: 71, next: 'Returns Jun 9',  hue: 268 },
    { make: 'Toyota',   model: 'RAV4',      year: 2023, plate: 'GHN-7745', status: 'On rental',   rate: 180, util: 88, next: 'Returns 10:30',  hue: 24  },
    { make: 'Ford',     model: 'Bronco',    year: 2023, plate: 'BRC-3320', status: 'Maintenance', rate: 270, util: 0,  next: 'Service due',    hue: 188 },
    { make: 'Jeep',     model: 'Wrangler',  year: 2022, plate: 'WRG-5567', status: 'Available',   rate: 240, util: 59, next: 'Idle 2 days',    hue: 96  },
    { make: 'Nissan',   model: 'Altima',    year: 2023, plate: 'ALT-7781', status: 'Available',   rate: 140, util: 52, next: 'Idle 1 day',     hue: 340 },
  ];

  const customers = [
    { name: 'Marcus Webb',   contact: 'm.webb@email.com',   rentals: 12, ltv: 14200, last: 'Jun 1',  status: 'Verified', rating: 4.9, hue: 222 },
    { name: 'Nina Park',     contact: 'nina.park@email.com',rentals: 9,  ltv: 12400, last: 'Jun 5',  status: 'Verified', rating: 4.9, hue: 12  },
    { name: 'Aisha Bello',   contact: 'a.bello@email.com',  rentals: 8,  ltv: 9800,  last: 'Jun 3',  status: 'Verified', rating: 5.0, hue: 200 },
    { name: 'Priya Nair',    contact: 'priya.n@email.com',  rentals: 6,  ltv: 4300,  last: 'May 28', status: 'Verified', rating: 4.8, hue: 268 },
    { name: 'Lena Ortiz',    contact: 'l.ortiz@email.com',  rentals: 5,  ltv: 5400,  last: 'Jun 2',  status: 'Verified', rating: 4.7, hue: 158 },
    { name: 'Sam Whitfield', contact: 's.white@email.com',  rentals: 4,  ltv: 3900,  last: 'May 30', status: 'Verified', rating: 4.6, hue: 188 },
    { name: 'Carlos Mendez', contact: 'c.mendez@email.com', rentals: 3,  ltv: 2100,  last: 'May 20', status: 'Blocked',  rating: 3.2, hue: 24  },
    { name: 'Devon Clarke',  contact: 'd.clarke@email.com', rentals: 1,  ltv: 560,   last: 'Jun 4',  status: 'Pending',  rating: 0,   hue: 96  },
  ];

  return { kpis, revTrend, revLabels, schedule, activity, actions, rentals, fleet, customers,
    tenant: { name: 'DB Car Rentals', code: 'DB', city: 'Miami, FL', admin: 'Daniel' } };
})();
