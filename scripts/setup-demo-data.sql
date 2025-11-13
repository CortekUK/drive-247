-- Demo Data Setup Script for Drive917
-- This script populates the database with comprehensive mock data

-- First, let's insert some vehicles
INSERT INTO vehicles (name, category, description, base_price_per_day, base_price_per_mile, image_url, is_active, service_status, features, specifications) VALUES
('Toyota Camry', 'Standard', 'Reliable and comfortable sedan perfect for daily commutes and city driving.', 45.00, 0.35, 'https://images.unsplash.com/photo-1621007947382-bb3c3994e3fb?w=800', true, 'available', '{"features": ["Bluetooth", "Backup Camera", "Air Conditioning", "Cruise Control"]}', '{"passengers": 5, "luggage": 2, "transmission": "Automatic", "fuelType": "Gasoline"}'),
('Honda Accord', 'Standard', 'Spacious sedan with excellent fuel economy and modern safety features.', 48.00, 0.38, 'https://images.unsplash.com/photo-1606664515524-ed2f786a0bd6?w=800', true, 'available', '{"features": ["Apple CarPlay", "Android Auto", "Lane Assist", "Adaptive Cruise"]}', '{"passengers": 5, "luggage": 2, "transmission": "Automatic", "fuelType": "Gasoline"}'),
('Chevrolet Malibu', 'Standard', 'Modern sedan with advanced safety technology and comfortable interior.', 46.00, 0.36, 'https://images.unsplash.com/photo-1552519507-da3b142c6e3d?w=800', true, 'available', '{"features": ["Heated Seats", "Remote Start", "WiFi Hotspot", "Blind Spot Monitor"]}', '{"passengers": 5, "luggage": 2, "transmission": "Automatic", "fuelType": "Gasoline"}'),
('Ford Explorer', 'SUV', 'Spacious 7-passenger SUV perfect for families and group travel.', 75.00, 0.55, 'https://images.unsplash.com/photo-1519641471654-76ce0107ad1b?w=800', true, 'available', '{"features": ["3rd Row Seating", "4WD", "Power Liftgate", "Navigation System"]}', '{"passengers": 7, "luggage": 4, "transmission": "Automatic", "fuelType": "Gasoline"}'),
('Jeep Grand Cherokee', 'SUV', 'Premium SUV with off-road capability and luxury interior.', 80.00, 0.60, 'https://images.unsplash.com/photo-1533473359331-0135ef1b58bf?w=800', true, 'available', '{"features": ["Leather Seats", "Panoramic Sunroof", "Trail Rated", "Premium Audio"]}', '{"passengers": 5, "luggage": 3, "transmission": "Automatic", "fuelType": "Gasoline"}'),
('Mercedes-Benz S-Class', 'Luxury', 'Ultimate luxury sedan with cutting-edge technology and supreme comfort.', 200.00, 1.50, 'https://images.unsplash.com/photo-1618843479313-40f8afb4b4d8?w=800', true, 'available', '{"features": ["Massaging Seats", "Executive Rear Seats", "MBUX System", "Air Suspension"]}', '{"passengers": 5, "luggage": 2, "transmission": "Automatic", "fuelType": "Gasoline"}'),
('BMW 7 Series', 'Luxury', 'Executive sedan combining performance with unparalleled luxury.', 190.00, 1.40, 'https://images.unsplash.com/photo-1617531653520-bd4f03871f0e?w=800', true, 'available', '{"features": ["Gesture Control", "Ambient Lighting", "Heated/Cooled Seats", "Head-Up Display"]}', '{"passengers": 5, "luggage": 2, "transmission": "Automatic", "fuelType": "Gasoline"}'),
('Cadillac Escalade', 'Luxury SUV', 'Full-size luxury SUV with commanding presence and premium amenities.', 180.00, 1.20, 'https://images.unsplash.com/photo-1519641471654-76ce0107ad1b?w=800', true, 'available', '{"features": ["OLED Display", "Super Cruise", "Premium Leather", "Rear Entertainment"]}', '{"passengers": 7, "luggage": 5, "transmission": "Automatic", "fuelType": "Gasoline"}'),
('Tesla Model S', 'Electric', 'High-performance electric sedan with autopilot and incredible range.', 150.00, 0.80, 'https://images.unsplash.com/photo-1617788138017-80ad40651399?w=800', true, 'available', '{"features": ["Autopilot", "17-inch Touchscreen", "Supercharging", "Glass Roof"]}', '{"passengers": 5, "luggage": 2, "transmission": "Electric", "fuelType": "Electric"}'),
('Chevrolet Suburban', 'Large SUV', 'Spacious family SUV with seating for up to 9 passengers.', 95.00, 0.70, 'https://images.unsplash.com/photo-1519641471654-76ce0107ad1b?w=800', true, 'available', '{"features": ["9 Passenger Seating", "Cargo Management", "Teen Driver Mode", "WiFi"]}', '{"passengers": 9, "luggage": 6, "transmission": "Automatic", "fuelType": "Gasoline"}')
ON CONFLICT (id) DO NOTHING;

-- Insert pricing extras
INSERT INTO pricing_extras (name, description, price, is_active, icon, category) VALUES
('GPS Navigation', 'Professional GPS navigation system with real-time traffic updates', 10.00, true, 'Navigation', 'equipment'),
('Child Safety Seat', 'Certified child safety seat for ages 2-4 years', 15.00, true, 'Baby', 'safety'),
('Booster Seat', 'Booster seat for children ages 4-8 years', 12.00, true, 'Baby', 'safety'),
('Additional Driver', 'Add an additional authorized driver to the rental', 25.00, true, 'UserPlus', 'insurance'),
('Roadside Assistance Premium', 'Premium 24/7 roadside assistance coverage', 20.00, true, 'Shield', 'insurance'),
('WiFi Hotspot', 'Portable WiFi hotspot device (unlimited data)', 15.00, true, 'Wifi', 'equipment'),
('Ski Rack', 'Roof-mounted ski and snowboard rack', 20.00, true, 'Mountain', 'equipment'),
('Bike Rack', 'Rear-mounted bike rack (up to 3 bikes)', 18.00, true, 'Bike', 'equipment'),
('Full Insurance Coverage', 'Comprehensive insurance with zero deductible', 45.00, true, 'Shield', 'insurance'),
('Airport Pickup', 'Convenient airport pickup service', 30.00, true, 'Plane', 'service')
ON CONFLICT (id) DO NOTHING;

-- Insert service inclusions
INSERT INTO service_inclusions (name, description, icon, is_default) VALUES
('24/7 Customer Support', 'Round-the-clock customer service available via phone, chat, or email', 'Headphones', true),
('Unlimited Mileage', 'Drive as much as you want with no mileage restrictions', 'Gauge', true),
('Free Cancellation', 'Cancel up to 24 hours before pickup for a full refund', 'XCircle', true),
('Roadside Assistance', 'Basic roadside assistance included at no extra charge', 'Wrench', true),
('Clean Vehicle Guarantee', 'Every vehicle professionally cleaned and sanitized before pickup', 'Sparkles', true),
('Flexible Pickup', 'Convenient pickup locations across Dallas and DFW area', 'MapPin', true)
ON CONFLICT (id) DO NOTHING;

-- Insert FAQs
INSERT INTO faqs (question, answer, category, display_order, is_active) VALUES
('What do I need to rent a car?', 'You need a valid driver''s license, a credit card in your name, and proof of insurance. International renters may need an International Driving Permit.', 'rental', 1, true),
('What is your cancellation policy?', 'You can cancel your reservation up to 24 hours before the scheduled pickup time for a full refund. Cancellations made less than 24 hours before pickup may incur a cancellation fee.', 'booking', 2, true),
('Do you offer insurance coverage?', 'Yes, we offer several insurance options including Collision Damage Waiver (CDW), Liability Insurance, and Personal Accident Insurance. Your personal auto insurance may also cover rental vehicles.', 'insurance', 3, true),
('Can I add an additional driver?', 'Yes, you can add additional drivers for a daily fee of $25. All additional drivers must meet our age and license requirements and be present at pickup.', 'rental', 4, true),
('What is your fuel policy?', 'All vehicles are provided with a full tank of gas. We ask that you return the vehicle with a full tank to avoid refueling charges.', 'rental', 5, true),
('Do you offer one-way rentals?', 'Yes, we offer one-way rentals within the Dallas-Fort Worth area. Additional fees may apply based on the drop-off location.', 'booking', 6, true),
('What happens if I return the car late?', 'A grace period of 29 minutes is provided. After that, you will be charged for an additional day at the daily rate plus any applicable fees.', 'rental', 7, true),
('Are pets allowed in rental vehicles?', 'Yes, pets are allowed in most vehicles with prior approval. A pet cleaning fee of $75 applies. Service animals are always welcome at no charge.', 'policies', 8, true),
('Do you provide child safety seats?', 'Yes, we offer child safety seats and booster seats for an additional daily fee. We recommend reserving these in advance to ensure availability.', 'rental', 9, true),
('What is your age requirement?', 'Drivers must be at least 21 years old. Drivers under 25 may be subject to a young driver surcharge and have vehicle restrictions.', 'policies', 10, true)
ON CONFLICT (id) DO NOTHING;

-- Insert testimonials
INSERT INTO testimonials (customer_name, customer_title, content, rating, is_active, is_featured, display_order, anonymised) VALUES
('Sarah Martinez', 'Business Executive', 'I''ve rented from Drive917 multiple times for business trips. Their vehicles are always clean, reliable, and the service is exceptional. Highly recommended!', 5, true, true, 1, false),
('Michael Johnson', 'Family Traveler', 'Rented a Suburban for our family vacation. The process was smooth, the vehicle was perfect for our needs, and the price was very competitive. Will definitely use again!', 5, true, true, 2, false),
('Jennifer Lee', 'Weekend Driver', 'Great experience from start to finish. The online booking was easy, pickup was quick, and the car was in excellent condition. Customer service was friendly and helpful.', 5, true, true, 3, false),
('David Thompson', 'Corporate Client', 'As a corporate client, I appreciate the professional service and attention to detail. Drive917 consistently delivers quality vehicles and reliable service.', 5, true, false, 4, false),
('Amanda White', 'Tourist', 'Visiting Dallas for the first time and needed a rental. Drive917 made it so easy! The car was perfect and their staff gave great recommendations for places to visit.', 5, true, false, 5, false),
('Robert Garcia', 'Long-term Renter', 'I''ve been renting monthly from Drive917 for the past 6 months. Excellent value, great vehicles, and they always accommodate my schedule changes. Couldn''t ask for better!', 5, true, false, 6, false),
('Emily Davis', 'Airport Traveler', 'Airport pickup service was a game-changer! The driver was on time, professional, and the car was ready to go. Made my business trip stress-free.', 5, true, false, 7, false),
('James Wilson', 'Luxury Seeker', 'Rented the Mercedes S-Class for a special occasion. The vehicle was immaculate and performed beautifully. The premium experience was worth every penny!', 5, true, true, 8, false)
ON CONFLICT (id) DO NOTHING;

-- Insert promotions
INSERT INTO promotions (title, description, discount_type, discount_value, code, valid_from, valid_until, is_active, terms_conditions, min_rental_days) VALUES
('Welcome Discount', 'Get 20% off your first rental with Drive917! Use code WELCOME20 at checkout.', 'percentage', 20, 'WELCOME20', CURRENT_DATE, CURRENT_DATE + INTERVAL '90 days', true, 'Valid for first-time customers only. Minimum 3-day rental required. Cannot be combined with other offers.', 3),
('Weekend Special', 'Save 15% on all weekend rentals (Friday-Monday)', 'percentage', 15, 'WEEKEND15', CURRENT_DATE, CURRENT_DATE + INTERVAL '60 days', true, 'Valid for rentals starting Friday through Monday. Must book at least 48 hours in advance.', 2),
('Monthly Saver', 'Rent for 30+ days and get $200 off your total', 'fixed', 200, 'MONTHLY200', CURRENT_DATE, CURRENT_DATE + INTERVAL '180 days', true, 'Applies to rentals of 30 days or longer. One-time discount per rental period.', 30),
('Holiday Special', 'Book now for the holidays! 25% off December rentals', 'percentage', 25, 'HOLIDAY25', CURRENT_DATE, DATE_TRUNC('year', CURRENT_DATE) + INTERVAL '1 year' - INTERVAL '1 day', true, 'Valid for rentals between December 1-31. Subject to availability. Blackout dates may apply.', 5)
ON CONFLICT (id) DO NOTHING;

-- Insert portfolio items
INSERT INTO portfolio (title, description, category, featured_image, date, client_name, location, is_featured, display_order) VALUES
('Corporate Event Transportation', 'Provided luxury transportation for a Fortune 500 company''s annual conference with a fleet of executive sedans.', 'corporate', 'https://images.unsplash.com/photo-1519832979-6fa011b87667?w=800', CURRENT_DATE - INTERVAL '30 days', 'TechCorp Industries', 'Dallas Convention Center', true, 1),
('Wedding Party Fleet Service', 'Coordinated transportation for a 200-guest wedding with luxury SUVs and sedans for the bridal party and guests.', 'wedding', 'https://images.unsplash.com/photo-1511285560929-80b456fea0bc?w=800', CURRENT_DATE - INTERVAL '45 days', 'Smith-Johnson Wedding', 'Four Seasons Dallas', true, 2),
('Airport Executive Transfer', 'VIP airport transfer service for international business delegation with luxury vehicles and professional chauffeurs.', 'airport', 'https://images.unsplash.com/photo-1436491865332-7a61a109cc05?w=800', CURRENT_DATE - INTERVAL '15 days', 'Global Ventures LLC', 'DFW International Airport', true, 3),
('Film Production Vehicle Support', 'Provided picture vehicles and crew transportation for a major film production in Dallas.', 'entertainment', 'https://images.unsplash.com/photo-1485846234645-a62644f84728?w=800', CURRENT_DATE - INTERVAL '60 days', 'Paramount Pictures', 'Downtown Dallas', false, 4),
('Charity Gala Transportation', 'Arranged premium transportation for 50+ guests attending the annual Children''s Hospital charity gala.', 'event', 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=800', CURRENT_DATE - INTERVAL '20 days', 'Children''s Hospital Foundation', 'Hilton Anatole', false, 5)
ON CONFLICT (id) DO NOTHING;

-- Insert drivers
INSERT INTO drivers (name, email, phone, license_number, license_expiry, is_active, rating, total_trips, specialization) VALUES
('John Mitchell', 'john.mitchell@drive917.com', '+1-214-555-0101', 'TX12345678', CURRENT_DATE + INTERVAL '2 years', true, 4.9, 245, 'Luxury Chauffeur'),
('Maria Rodriguez', 'maria.rodriguez@drive917.com', '+1-214-555-0102', 'TX23456789', CURRENT_DATE + INTERVAL '3 years', true, 4.8, 189, 'Airport Specialist'),
('David Chen', 'david.chen@drive917.com', '+1-214-555-0103', 'TX34567890', CURRENT_DATE + INTERVAL '1 year', true, 4.7, 156, 'Corporate Events'),
('Patricia Williams', 'patricia.williams@drive917.com', '+1-214-555-0104', 'TX45678901', CURRENT_DATE + INTERVAL '2 years', true, 4.9, 198, 'Wedding & Special Events'),
('James Anderson', 'james.anderson@drive917.com', '+1-214-555-0105', 'TX56789012', CURRENT_DATE + INTERVAL '18 months', true, 4.6, 134, 'Long Distance Travel')
ON CONFLICT (id) DO NOTHING;

-- Insert site settings
INSERT INTO site_settings (key, value, description, category) VALUES
('site_name', 'Drive917', 'The name of the website', 'general'),
('contact_email', 'info@drive917.com', 'Primary contact email address', 'contact'),
('contact_phone', '+1-214-555-0100', 'Primary contact phone number', 'contact'),
('business_address', '123 Main Street, Dallas, TX 75201', 'Business physical address', 'contact'),
('business_hours', 'Mon-Fri: 8AM-8PM, Sat-Sun: 9AM-6PM', 'Business operating hours', 'general'),
('booking_advance_days', '365', 'Maximum days in advance for booking', 'booking'),
('min_rental_age', '21', 'Minimum age requirement for rental', 'policies'),
('cancellation_hours', '24', 'Hours before pickup for free cancellation', 'policies'),
('security_deposit', '250', 'Standard security deposit amount', 'policies'),
('late_return_grace_minutes', '29', 'Grace period for late returns in minutes', 'policies')
ON CONFLICT (key) DO NOTHING;

-- Success message
DO $$
BEGIN
  RAISE NOTICE 'Demo data setup completed successfully!';
  RAISE NOTICE 'Vehicles: 10 added';
  RAISE NOTICE 'Pricing Extras: 10 added';
  RAISE NOTICE 'Service Inclusions: 6 added';
  RAISE NOTICE 'FAQs: 10 added';
  RAISE NOTICE 'Testimonials: 8 added';
  RAISE NOTICE 'Promotions: 4 added';
  RAISE NOTICE 'Portfolio Items: 5 added';
  RAISE NOTICE 'Drivers: 5 added';
  RAISE NOTICE 'Site Settings: 10 added';
END $$;
