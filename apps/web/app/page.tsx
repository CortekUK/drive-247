'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import useEmblaCarousel from 'embla-carousel-react';
import { supabase } from '@/lib/supabase';

export default function LandingPage() {
  const [emblaRef] = useEmblaCarousel({ loop: true, duration: 30 });
  const [formData, setFormData] = useState({
    companyName: '',
    contactName: '',
    email: '',
    phone: '',
    message: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<'idle' | 'success' | 'error'>('idle');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setSubmitStatus('idle');

    try {
      const { error } = await supabase
        .from('contact_requests')
        .insert([
          {
            company_name: formData.companyName,
            contact_name: formData.contactName,
            email: formData.email,
            phone: formData.phone || null,
            message: formData.message || null,
            status: 'pending',
          }
        ]);

      if (error) throw error;

      setSubmitStatus('success');
      setFormData({
        companyName: '',
        contactName: '',
        email: '',
        phone: '',
        message: '',
      });
    } catch (error) {
      console.error('Error submitting form:', error);
      setSubmitStatus('error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setFormData(prev => ({
      ...prev,
      [e.target.name]: e.target.value
    }));
  };

  const carImages = [
    'https://images.unsplash.com/photo-1549399542-7e3f8b79c341?w=1200&q=80',
    'https://images.unsplash.com/photo-1552519507-da3b142c6e3d?w=1200&q=80',
    'https://images.unsplash.com/photo-1605559424843-9e4c228bf1c2?w=1200&q=80',
    'https://images.unsplash.com/photo-1606664515524-ed2f786a0bd6?w=1200&q=80',
  ];

  const features = [
    { icon: '🚗', title: 'Fleet Management', desc: 'Track your entire vehicle fleet with real-time availability, maintenance schedules, and automated alerts.' },
    { icon: '📅', title: 'Smart Booking System', desc: 'Accept bookings 24/7 with an intuitive calendar, automatic pricing, and instant confirmations.' },
    { icon: '💳', title: 'Payment Processing', desc: 'Integrated Stripe payments with pre-authorization, invoicing, and automated billing.' },
    { icon: '📱', title: 'Mobile-First Design', desc: 'Fully responsive platform that works seamlessly on all devices for customers and admins.' },
    { icon: '🔒', title: 'Secure & Compliant', desc: 'Enterprise-grade security with role-based access, data encryption, and audit logs.' },
    { icon: '📊', title: 'Analytics Dashboard', desc: 'Real-time insights into revenue, utilization rates, customer behavior, and operational KPIs.' },
  ];

  const testimonials = [
    {
      name: 'Sarah Johnson',
      company: 'Premium Rentals Ltd',
      image: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&q=80',
      text: 'Cortek transformed our business. We went from manual spreadsheets to a fully automated system in days. Revenue up 40%!',
      rating: 5,
    },
    {
      name: 'Michael Chen',
      company: 'Urban Drive Co',
      image: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&q=80',
      text: 'The multi-tenant architecture is perfect for scaling. We now manage 3 brands from one platform with isolated data.',
      rating: 5,
    },
    {
      name: 'Emily Rodriguez',
      company: 'Elite Fleet Services',
      image: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=150&q=80',
      text: 'Customer support is incredible. They helped migrate our entire database and trained our team in under a week.',
      rating: 5,
    },
  ];

  const stats = [
    { number: '500+', label: 'Active Vehicles' },
    { number: '50K+', label: 'Bookings Processed' },
    { number: '99.9%', label: 'Uptime SLA' },
    { number: '24/7', label: 'Support Available' },
  ];

  const pricingPlans = [
    {
      name: 'Starter',
      price: '$199',
      period: '/month',
      features: ['Up to 25 vehicles', '1000 bookings/month', 'Basic analytics', 'Email support', 'Stripe integration'],
      popular: false,
    },
    {
      name: 'Professional',
      price: '$499',
      period: '/month',
      features: ['Up to 100 vehicles', 'Unlimited bookings', 'Advanced analytics', 'Priority support', 'All integrations', 'Custom branding'],
      popular: true,
    },
    {
      name: 'Enterprise',
      price: 'Custom',
      period: '',
      features: ['Unlimited vehicles', 'Unlimited bookings', 'Custom analytics', 'Dedicated support', 'White-label solution', 'Custom integrations'],
      popular: false,
    },
  ];

  return (
    <div className="min-h-screen bg-dark-bg">
      {/* Navigation */}
      <nav className="border-b border-dark-border bg-dark-card/50 backdrop-blur-sm fixed w-full z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <motion.div
              className="flex-shrink-0"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5 }}
            >
              <h1 className="text-2xl font-bold gradient-text">CORTEK</h1>
              <p className="text-xs text-gray-400">Drive Platform</p>
            </motion.div>
            <div className="hidden md:block">
              <div className="ml-10 flex items-baseline space-x-4">
                <a href="#features" className="text-gray-300 hover:text-primary-400 px-3 py-2 rounded-md text-sm font-medium transition">Features</a>
                <a href="#testimonials" className="text-gray-300 hover:text-primary-400 px-3 py-2 rounded-md text-sm font-medium transition">Testimonials</a>
                <a href="#pricing" className="text-gray-300 hover:text-primary-400 px-3 py-2 rounded-md text-sm font-medium transition">Pricing</a>
                <a href="#contact" className="text-gray-300 hover:text-primary-400 px-3 py-2 rounded-md text-sm font-medium transition">Contact</a>
              </div>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section with Carousel */}
      <section className="pt-32 pb-20 px-4 sm:px-6 lg:px-8 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary-900/20 via-dark-bg to-accent-900/20"></div>
        <div className="max-w-7xl mx-auto relative z-10">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8 }}
            >
              <h2 className="text-5xl md:text-7xl font-extrabold mb-6">
                <span className="gradient-text">Grow Faster</span>
                <br />
                <span className="text-white">with Bespoke Rental Systems</span>
              </h2>
              <p className="mt-6 text-xl text-gray-400 max-w-2xl">
                Launch your car rental business in minutes with our multi-tenant SAAS platform.
                Manage fleets, bookings, payments, and customers from one powerful dashboard.
              </p>
              <div className="mt-10 flex gap-4">
                <motion.a
                  href="#contact"
                  className="inline-block bg-primary-600 hover:bg-primary-700 text-white px-8 py-4 rounded-lg text-lg font-semibold transition"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                >
                  Get Started
                </motion.a>
                <motion.a
                  href="#features"
                  className="inline-block border border-primary-600 text-primary-400 hover:bg-primary-600/10 px-8 py-4 rounded-lg text-lg font-semibold transition"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                >
                  Learn More
                </motion.a>
              </div>
            </motion.div>

            {/* Carousel */}
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.8, delay: 0.2 }}
              className="relative"
            >
              <div className="overflow-hidden rounded-2xl shadow-2xl" ref={emblaRef}>
                <div className="flex">
                  {carImages.map((image, idx) => (
                    <div key={idx} className="flex-[0_0_100%] min-w-0">
                      <img src={image} alt={`Luxury car ${idx + 1}`} className="w-full h-[400px] object-cover" />
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="py-12 bg-dark-card/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {stats.map((stat, idx) => (
              <motion.div
                key={idx}
                className="text-center"
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: idx * 0.1 }}
              >
                <div className="text-4xl md:text-5xl font-bold gradient-text mb-2">{stat.number}</div>
                <div className="text-gray-400 text-sm md:text-base">{stat.label}</div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-20 bg-dark-bg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            className="text-center mb-16"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            <h2 className="text-3xl md:text-5xl font-extrabold text-white mb-4">Everything You Need</h2>
            <p className="text-gray-400 text-lg max-w-2xl mx-auto">
              Built by rental operators, for rental operators. Every feature designed to save time and increase revenue.
            </p>
          </motion.div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {features.map((feature, idx) => (
              <motion.div
                key={idx}
                className="bg-dark-card border border-dark-border rounded-xl p-8 hover:border-primary-600 transition-all"
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: idx * 0.1 }}
                whileHover={{ scale: 1.05, y: -5 }}
              >
                <div className="text-4xl mb-4">{feature.icon}</div>
                <h3 className="text-xl font-bold text-white mb-3">{feature.title}</h3>
                <p className="text-gray-400">{feature.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials Section */}
      <section id="testimonials" className="py-20 bg-dark-card/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            className="text-center mb-16"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            <h2 className="text-3xl md:text-5xl font-extrabold text-white mb-4">Loved by Rental Operators</h2>
            <p className="text-gray-400 text-lg">See what our customers have to say</p>
          </motion.div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {testimonials.map((testimonial, idx) => (
              <motion.div
                key={idx}
                className="bg-dark-card border border-dark-border rounded-xl p-8"
                initial={{ opacity: 0, scale: 0.9 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: idx * 0.15 }}
              >
                <div className="flex items-center mb-4">
                  {[...Array(testimonial.rating)].map((_, i) => (
                    <span key={i} className="text-yellow-400 text-xl">★</span>
                  ))}
                </div>
                <p className="text-gray-300 mb-6 italic">&ldquo;{testimonial.text}&rdquo;</p>
                <div className="flex items-center">
                  <img src={testimonial.image} alt={testimonial.name} className="w-12 h-12 rounded-full mr-4" />
                  <div>
                    <div className="text-white font-semibold">{testimonial.name}</div>
                    <div className="text-gray-400 text-sm">{testimonial.company}</div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="py-20 bg-dark-bg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            className="text-center mb-16"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            <h2 className="text-3xl md:text-5xl font-extrabold text-white mb-4">Simple, Transparent Pricing</h2>
            <p className="text-gray-400 text-lg">Choose the plan that fits your business size</p>
          </motion.div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {pricingPlans.map((plan, idx) => (
              <motion.div
                key={idx}
                className={`bg-dark-card border ${plan.popular ? 'border-primary-600 ring-2 ring-primary-600' : 'border-dark-border'} rounded-xl p-8 relative`}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: idx * 0.1 }}
                whileHover={{ scale: 1.03 }}
              >
                {plan.popular && (
                  <div className="absolute -top-4 left-1/2 transform -translate-x-1/2 bg-primary-600 text-white px-4 py-1 rounded-full text-sm font-semibold">
                    MOST POPULAR
                  </div>
                )}
                <h3 className="text-2xl font-bold text-white mb-2">{plan.name}</h3>
                <div className="mb-6">
                  <span className="text-5xl font-extrabold gradient-text">{plan.price}</span>
                  <span className="text-gray-400">{plan.period}</span>
                </div>
                <ul className="space-y-3 mb-8">
                  {plan.features.map((feature, i) => (
                    <li key={i} className="flex items-start text-gray-300">
                      <span className="text-primary-400 mr-2">✓</span>
                      {feature}
                    </li>
                  ))}
                </ul>
                <a
                  href="#contact"
                  className={`block w-full text-center py-3 rounded-lg font-semibold transition ${
                    plan.popular
                      ? 'bg-primary-600 hover:bg-primary-700 text-white'
                      : 'border border-primary-600 text-primary-400 hover:bg-primary-600/10'
                  }`}
                >
                  Get Started
                </a>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Contact Form */}
      <section id="contact" className="py-20 bg-dark-card/30">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            className="text-center mb-12"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            <h2 className="text-3xl md:text-5xl font-extrabold text-white mb-4">Get in Touch</h2>
            <p className="text-gray-400 text-lg">Start your 14-day free trial today. No credit card required.</p>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            <form
              onSubmit={handleSubmit}
              className="space-y-6 bg-dark-card border border-dark-border rounded-xl p-8"
            >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Company Name *</label>
                <input
                  type="text"
                  name="companyName"
                  required
                  value={formData.companyName}
                  onChange={handleChange}
                  className="w-full px-4 py-3 bg-dark-bg border border-dark-border rounded-lg text-white focus:border-primary-600 focus:ring-1 focus:ring-primary-600 transition"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Contact Name *</label>
                <input
                  type="text"
                  name="contactName"
                  required
                  value={formData.contactName}
                  onChange={handleChange}
                  className="w-full px-4 py-3 bg-dark-bg border border-dark-border rounded-lg text-white focus:border-primary-600 focus:ring-1 focus:ring-primary-600 transition"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Email *</label>
                <input
                  type="email"
                  name="email"
                  required
                  value={formData.email}
                  onChange={handleChange}
                  className="w-full px-4 py-3 bg-dark-bg border border-dark-border rounded-lg text-white focus:border-primary-600 focus:ring-1 focus:ring-primary-600 transition"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Phone</label>
                <input
                  type="tel"
                  name="phone"
                  value={formData.phone}
                  onChange={handleChange}
                  className="w-full px-4 py-3 bg-dark-bg border border-dark-border rounded-lg text-white focus:border-primary-600 focus:ring-1 focus:ring-primary-600 transition"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Message</label>
              <textarea
                name="message"
                rows={4}
                value={formData.message}
                onChange={handleChange}
                className="w-full px-4 py-3 bg-dark-bg border border-dark-border rounded-lg text-white focus:border-primary-600 focus:ring-1 focus:ring-primary-600 transition"
              ></textarea>
            </div>
            {submitStatus === 'success' && (
              <div className="rounded-lg bg-green-900/20 border border-green-700/50 p-4">
                <p className="text-sm text-green-400">Thank you! We'll get back to you within 24 hours.</p>
              </div>
            )}
            {submitStatus === 'error' && (
              <div className="rounded-lg bg-red-900/20 border border-red-700/50 p-4">
                <p className="text-sm text-red-400">Something went wrong. Please try again.</p>
              </div>
            )}
            <motion.button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-4 px-6 bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-semibold transition disabled:opacity-50"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              {isSubmitting ? 'Sending...' : 'Send Message'}
            </motion.button>
            </form>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-dark-card border-t border-dark-border py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
            <div>
              <h3 className="text-xl font-bold gradient-text mb-4">CORTEK</h3>
              <p className="text-gray-400 text-sm">Powering rental businesses worldwide with cutting-edge technology.</p>
            </div>
            <div>
              <h4 className="text-white font-semibold mb-4">Product</h4>
              <ul className="space-y-2 text-gray-400 text-sm">
                <li><a href="#features" className="hover:text-primary-400 transition">Features</a></li>
                <li><a href="#pricing" className="hover:text-primary-400 transition">Pricing</a></li>
                <li><a href="#testimonials" className="hover:text-primary-400 transition">Testimonials</a></li>
              </ul>
            </div>
            <div>
              <h4 className="text-white font-semibold mb-4">Company</h4>
              <ul className="space-y-2 text-gray-400 text-sm">
                <li><a href="#" className="hover:text-primary-400 transition">About Us</a></li>
                <li><a href="#contact" className="hover:text-primary-400 transition">Contact</a></li>
                <li><a href="#" className="hover:text-primary-400 transition">Careers</a></li>
              </ul>
            </div>
            <div>
              <h4 className="text-white font-semibold mb-4">Legal</h4>
              <ul className="space-y-2 text-gray-400 text-sm">
                <li><a href="#" className="hover:text-primary-400 transition">Privacy Policy</a></li>
                <li><a href="#" className="hover:text-primary-400 transition">Terms of Service</a></li>
                <li><a href="#" className="hover:text-primary-400 transition">Security</a></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-dark-border pt-8 text-center text-gray-400">
            <p>&copy; 2025 Cortek. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
