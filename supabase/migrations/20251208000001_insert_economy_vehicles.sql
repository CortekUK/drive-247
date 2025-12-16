-- Insert 10 economical daily-use vehicles
INSERT INTO vehicles (
  reg,
  make,
  model,
  year,
  colour,
  status,
  daily_rent,
  weekly_rent,
  monthly_rent,
  description,
  acquisition_type,
  acquisition_date,
  purchase_price,
  has_logbook,
  has_spare_key,
  has_tracker,
  has_service_plan,
  mot_due_date,
  tax_due_date,
  photo_url
) VALUES
-- 1. Toyota Corolla - Reliable economy sedan
(
  'EC24 TYC',
  'Toyota',
  'Corolla',
  2023,
  'Silver',
  'Available',
  45,
  280,
  950,
  'Reliable and fuel-efficient sedan. Perfect for daily commuting with excellent fuel economy and low maintenance costs.',
  'Purchase',
  '2024-01-15',
  22000,
  true,
  true,
  true,
  true,
  '2025-06-15',
  '2025-06-15',
  'https://images.unsplash.com/photo-1623869675781-80aa31012a5a?w=800&q=80'
),
-- 2. Honda Civic - Popular compact
(
  'EC24 HCV',
  'Honda',
  'Civic',
  2023,
  'White',
  'Available',
  48,
  295,
  980,
  'Sporty compact sedan with excellent reliability. Great fuel economy and comfortable interior for everyday driving.',
  'Purchase',
  '2024-02-10',
  23500,
  true,
  true,
  true,
  true,
  '2025-07-10',
  '2025-07-10',
  'https://images.unsplash.com/photo-1606611013016-969c19ba27bb?w=800&q=80'
),
-- 3. Ford Focus - Versatile hatchback
(
  'EC24 FFO',
  'Ford',
  'Focus',
  2022,
  'Blue',
  'Available',
  42,
  260,
  880,
  'Practical hatchback with responsive handling. Ideal for city driving and highway commutes.',
  'Purchase',
  '2023-11-20',
  19500,
  true,
  true,
  true,
  false,
  '2025-05-20',
  '2025-05-20',
  'https://images.unsplash.com/photo-1551830820-330a71b99659?w=800&q=80'
),
-- 4. Volkswagen Golf - European efficiency
(
  'EC24 VWG',
  'Volkswagen',
  'Golf',
  2023,
  'Grey',
  'Available',
  50,
  310,
  1050,
  'Premium compact with German engineering. Refined interior, excellent build quality, and efficient performance.',
  'Finance',
  '2024-03-05',
  26000,
  true,
  true,
  true,
  true,
  '2025-08-05',
  '2025-08-05',
  'https://images.unsplash.com/photo-1471444928139-48c5bf5173f8?w=800&q=80'
),
-- 5. Hyundai Elantra - Value champion
(
  'EC24 HYE',
  'Hyundai',
  'Elantra',
  2023,
  'Red',
  'Available',
  40,
  250,
  850,
  'Modern sedan with comprehensive warranty. Feature-rich interior with excellent value for money.',
  'Purchase',
  '2024-01-25',
  21000,
  true,
  true,
  true,
  true,
  '2025-06-25',
  '2025-06-25',
  'https://images.unsplash.com/photo-1629897048514-3dd7414fe72a?w=800&q=80'
),
-- 6. Kia Forte - Reliable compact
(
  'EC24 KFT',
  'Kia',
  'Forte',
  2022,
  'Black',
  'Available',
  38,
  240,
  820,
  'Well-equipped compact sedan with excellent warranty coverage. Smooth ride and good fuel efficiency.',
  'Purchase',
  '2023-10-15',
  19000,
  true,
  true,
  true,
  false,
  '2025-04-15',
  '2025-04-15',
  'https://images.unsplash.com/photo-1619682817481-e994891cd1f5?w=800&q=80'
),
-- 7. Nissan Sentra - Comfortable commuter
(
  'EC24 NSN',
  'Nissan',
  'Sentra',
  2023,
  'Silver',
  'Available',
  42,
  265,
  900,
  'Spacious interior with modern safety features. Comfortable seats ideal for longer commutes.',
  'Purchase',
  '2024-02-28',
  20500,
  true,
  true,
  true,
  true,
  '2025-07-28',
  '2025-07-28',
  'https://images.unsplash.com/photo-1580273916550-e323be2ae537?w=800&q=80'
),
-- 8. Mazda 3 - Premium feel
(
  'EC24 MZ3',
  'Mazda',
  '3',
  2023,
  'White',
  'Available',
  52,
  320,
  1100,
  'Upscale compact with engaging driving dynamics. Premium interior materials and excellent handling.',
  'Finance',
  '2024-04-10',
  25000,
  true,
  true,
  true,
  true,
  '2025-09-10',
  '2025-09-10',
  'https://images.unsplash.com/photo-1553440569-bcc63803a83d?w=800&q=80'
),
-- 9. Chevrolet Cruze - Practical choice
(
  'EC24 CHC',
  'Chevrolet',
  'Cruze',
  2022,
  'Blue',
  'Available',
  36,
  225,
  780,
  'Practical sedan with good trunk space. Efficient engine and comfortable ride for daily use.',
  'Purchase',
  '2023-09-20',
  18000,
  true,
  true,
  true,
  false,
  '2025-03-20',
  '2025-03-20',
  'https://images.unsplash.com/photo-1502877338535-766e1452684a?w=800&q=80'
),
-- 10. Subaru Impreza - All-weather capable
(
  'EC24 SBI',
  'Subaru',
  'Impreza',
  2023,
  'Grey',
  'Available',
  48,
  300,
  1000,
  'Standard all-wheel drive for all weather conditions. Safe and reliable with excellent visibility.',
  'Purchase',
  '2024-03-15',
  24000,
  true,
  true,
  true,
  true,
  '2025-08-15',
  '2025-08-15',
  'https://images.unsplash.com/photo-1626668893632-6f3a4466d22f?w=800&q=80'
);

-- Insert photos into vehicle_photos table (required for client website display)
INSERT INTO vehicle_photos (vehicle_id, photo_url, display_order)
SELECT id, 'https://images.unsplash.com/photo-1623869675781-80aa31012a5a?w=800&q=80', 1 FROM vehicles WHERE reg = 'EC24 TYC'
UNION ALL
SELECT id, 'https://images.unsplash.com/photo-1606611013016-969c19ba27bb?w=800&q=80', 1 FROM vehicles WHERE reg = 'EC24 HCV'
UNION ALL
SELECT id, 'https://images.unsplash.com/photo-1551830820-330a71b99659?w=800&q=80', 1 FROM vehicles WHERE reg = 'EC24 FFO'
UNION ALL
SELECT id, 'https://images.unsplash.com/photo-1471444928139-48c5bf5173f8?w=800&q=80', 1 FROM vehicles WHERE reg = 'EC24 VWG'
UNION ALL
SELECT id, 'https://images.unsplash.com/photo-1629897048514-3dd7414fe72a?w=800&q=80', 1 FROM vehicles WHERE reg = 'EC24 HYE'
UNION ALL
SELECT id, 'https://images.unsplash.com/photo-1619682817481-e994891cd1f5?w=800&q=80', 1 FROM vehicles WHERE reg = 'EC24 KFT'
UNION ALL
SELECT id, 'https://images.unsplash.com/photo-1580273916550-e323be2ae537?w=800&q=80', 1 FROM vehicles WHERE reg = 'EC24 NSN'
UNION ALL
SELECT id, 'https://images.unsplash.com/photo-1553440569-bcc63803a83d?w=800&q=80', 1 FROM vehicles WHERE reg = 'EC24 MZ3'
UNION ALL
SELECT id, 'https://images.unsplash.com/photo-1502877338535-766e1452684a?w=800&q=80', 1 FROM vehicles WHERE reg = 'EC24 CHC'
UNION ALL
SELECT id, 'https://images.unsplash.com/photo-1626668893632-6f3a4466d22f?w=800&q=80', 1 FROM vehicles WHERE reg = 'EC24 SBI';
