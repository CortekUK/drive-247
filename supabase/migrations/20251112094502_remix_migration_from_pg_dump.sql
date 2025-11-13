--
-- PostgreSQL database dump
--


-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--



--
-- Name: app_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.app_role AS ENUM (
    'admin',
    'moderator',
    'user'
);


--
-- Name: get_audit_logs_with_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_audit_logs_with_admin() RETURNS TABLE(id uuid, user_id uuid, action text, resource_type text, resource_id text, created_at timestamp with time zone, user_email text, user_name text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  -- Only admins can call this
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT 
    al.id,
    al.user_id,
    al.action,
    al.resource_type,
    al.resource_id,
    al.created_at,
    au.email as user_email,
    au.raw_user_meta_data->>'full_name' as user_name
  FROM public.audit_logs al
  LEFT JOIN auth.users au ON al.user_id = au.id
  ORDER BY al.created_at DESC;
END;
$$;


--
-- Name: has_role(uuid, public.app_role); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  );
END;
$$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


SET default_table_access_method = heap;

--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    action text NOT NULL,
    resource_type text NOT NULL,
    resource_id text,
    details jsonb,
    ip_address text,
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    table_name text,
    affected_entity_type text,
    affected_entity_id text,
    summary text,
    old_values jsonb,
    new_values jsonb
);


--
-- Name: blocked_dates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.blocked_dates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    date date NOT NULL,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: bookings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bookings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    booking_reference text DEFAULT ('BK-'::text || upper("substring"((gen_random_uuid())::text, 1, 8))) NOT NULL,
    vehicle_id uuid,
    customer_name text NOT NULL,
    customer_email text NOT NULL,
    customer_phone text NOT NULL,
    pickup_location text NOT NULL,
    dropoff_location text,
    pickup_date date NOT NULL,
    pickup_time time without time zone NOT NULL,
    dropoff_date date,
    dropoff_time time without time zone,
    passengers integer DEFAULT 1,
    luggage integer DEFAULT 0,
    special_requests text,
    estimated_price numeric(10,2),
    status text DEFAULT 'pending'::text,
    payment_status text DEFAULT 'pending'::text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    total_price numeric(10,2),
    rental_duration_days integer DEFAULT 1,
    rental_days integer
);


--
-- Name: clients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.clients (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    phone text NOT NULL,
    license_number text,
    address text,
    city text,
    postal_code text,
    country text DEFAULT 'United Kingdom'::text,
    date_of_birth date,
    total_bookings integer DEFAULT 0,
    total_spent numeric(10,2) DEFAULT 0,
    vip_status boolean DEFAULT false,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    license_expiry_date date,
    license_upload_url text,
    client_status text DEFAULT 'active'::text,
    active_rentals_count integer DEFAULT 0,
    last_booking_date date,
    preferred_vehicle_category text,
    total_rentals_completed integer DEFAULT 0,
    admin_notes text
);


--
-- Name: drivers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.drivers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    full_name text NOT NULL,
    email text NOT NULL,
    phone text NOT NULL,
    license_number text NOT NULL,
    license_expiry date NOT NULL,
    date_of_birth date NOT NULL,
    address text,
    city text,
    postal_code text,
    emergency_contact_name text,
    emergency_contact_phone text,
    hire_date date DEFAULT CURRENT_DATE,
    status text DEFAULT 'active'::text,
    rating numeric(3,2) DEFAULT 5.00,
    total_trips integer DEFAULT 0,
    specializations text[] DEFAULT '{}'::text[],
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    name text,
    is_available boolean DEFAULT true
);


--
-- Name: faqs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.faqs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    question text NOT NULL,
    answer text NOT NULL,
    category text DEFAULT 'general'::text,
    is_active boolean DEFAULT true,
    display_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: feedback_submissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.feedback_submissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_name text NOT NULL,
    customer_email text NOT NULL,
    customer_phone text,
    service_type text,
    booking_reference text,
    rating integer,
    feedback_message text NOT NULL,
    would_recommend boolean DEFAULT true,
    gdpr_consent boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'pending'::text,
    CONSTRAINT feedback_submissions_rating_check CHECK (((rating >= 1) AND (rating <= 5)))
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    title text NOT NULL,
    message text NOT NULL,
    type text DEFAULT 'info'::text,
    is_read boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    related_booking_id uuid,
    metadata jsonb DEFAULT '{}'::jsonb
);


--
-- Name: portfolio; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portfolio (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    description text,
    category text NOT NULL,
    image_url text,
    event_date date,
    client_name text,
    location text,
    is_published boolean DEFAULT true,
    display_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    slug text,
    summary text,
    full_description text,
    cover_image_url text,
    service_type text,
    gallery_images text[] DEFAULT '{}'::text[],
    vehicle_used text,
    testimonial_quote text,
    featured boolean DEFAULT false,
    duration text,
    special_requirements text,
    testimonial_author text,
    price_range text,
    is_featured boolean DEFAULT false
);


--
-- Name: portfolio_images; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portfolio_images (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    portfolio_id uuid NOT NULL,
    image_url text NOT NULL,
    caption text,
    display_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: pricing_extras; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pricing_extras (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    description text,
    price numeric(10,2) NOT NULL,
    price_type text DEFAULT 'fixed'::text,
    category text,
    is_active boolean DEFAULT true,
    display_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    extra_name text
);


--
-- Name: promotions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.promotions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    description text,
    discount_type text NOT NULL,
    discount_value numeric(10,2) NOT NULL,
    promo_code text,
    valid_from date NOT NULL,
    valid_until date NOT NULL,
    is_active boolean DEFAULT true,
    max_uses integer,
    current_uses integer DEFAULT 0,
    min_booking_amount numeric(10,2),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    terms_conditions text,
    applicable_services text[] DEFAULT '{}'::text[],
    start_date date,
    end_date date,
    image_url text
);


--
-- Name: service_inclusions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_inclusions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    description text,
    icon text,
    is_active boolean DEFAULT true,
    display_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    category text DEFAULT 'general'::text,
    icon_name text
);


--
-- Name: site_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.site_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    setting_key text NOT NULL,
    setting_value text,
    setting_type text DEFAULT 'text'::text,
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: testimonials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.testimonials (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_name text NOT NULL,
    customer_title text,
    content text NOT NULL,
    rating integer DEFAULT 5,
    is_active boolean DEFAULT true,
    is_featured boolean DEFAULT false,
    display_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    review_text text,
    anonymised boolean DEFAULT false,
    CONSTRAINT testimonials_rating_check CHECK (((rating >= 1) AND (rating <= 5)))
);


--
-- Name: user_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    role public.app_role NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: vehicles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vehicles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    category text NOT NULL,
    description text,
    image_url text,
    daily_rate numeric(10,2) DEFAULT 0 NOT NULL,
    hourly_rate numeric(10,2),
    weekly_rate numeric(10,2),
    monthly_rate numeric(10,2),
    passengers integer DEFAULT 4 NOT NULL,
    luggage integer DEFAULT 2 NOT NULL,
    features text[] DEFAULT '{}'::text[],
    is_available boolean DEFAULT true,
    display_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    capacity integer DEFAULT 4,
    luggage_capacity integer DEFAULT 2,
    base_price_per_mile numeric(10,2) DEFAULT 0,
    overnight_surcharge numeric(10,2) DEFAULT 0,
    service_status text DEFAULT 'active'::text,
    transmission_type text DEFAULT 'Automatic'::text,
    fuel_type text DEFAULT 'Petrol'::text,
    registration_number text,
    is_active boolean DEFAULT true
);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: blocked_dates blocked_dates_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blocked_dates
    ADD CONSTRAINT blocked_dates_date_key UNIQUE (date);


--
-- Name: blocked_dates blocked_dates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blocked_dates
    ADD CONSTRAINT blocked_dates_pkey PRIMARY KEY (id);


--
-- Name: bookings bookings_booking_reference_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_booking_reference_key UNIQUE (booking_reference);


--
-- Name: bookings bookings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_pkey PRIMARY KEY (id);


--
-- Name: clients clients_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_email_key UNIQUE (email);


--
-- Name: clients clients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_pkey PRIMARY KEY (id);


--
-- Name: drivers drivers_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.drivers
    ADD CONSTRAINT drivers_email_key UNIQUE (email);


--
-- Name: drivers drivers_license_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.drivers
    ADD CONSTRAINT drivers_license_number_key UNIQUE (license_number);


--
-- Name: drivers drivers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.drivers
    ADD CONSTRAINT drivers_pkey PRIMARY KEY (id);


--
-- Name: faqs faqs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.faqs
    ADD CONSTRAINT faqs_pkey PRIMARY KEY (id);


--
-- Name: feedback_submissions feedback_submissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feedback_submissions
    ADD CONSTRAINT feedback_submissions_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: portfolio_images portfolio_images_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolio_images
    ADD CONSTRAINT portfolio_images_pkey PRIMARY KEY (id);


--
-- Name: portfolio portfolio_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolio
    ADD CONSTRAINT portfolio_pkey PRIMARY KEY (id);


--
-- Name: pricing_extras pricing_extras_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_extras
    ADD CONSTRAINT pricing_extras_pkey PRIMARY KEY (id);


--
-- Name: promotions promotions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promotions
    ADD CONSTRAINT promotions_pkey PRIMARY KEY (id);


--
-- Name: promotions promotions_promo_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promotions
    ADD CONSTRAINT promotions_promo_code_key UNIQUE (promo_code);


--
-- Name: service_inclusions service_inclusions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_inclusions
    ADD CONSTRAINT service_inclusions_pkey PRIMARY KEY (id);


--
-- Name: site_settings site_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_settings
    ADD CONSTRAINT site_settings_pkey PRIMARY KEY (id);


--
-- Name: site_settings site_settings_setting_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_settings
    ADD CONSTRAINT site_settings_setting_key_key UNIQUE (setting_key);


--
-- Name: testimonials testimonials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.testimonials
    ADD CONSTRAINT testimonials_pkey PRIMARY KEY (id);


--
-- Name: user_roles user_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_pkey PRIMARY KEY (id);


--
-- Name: user_roles user_roles_user_id_role_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_role_key UNIQUE (user_id, role);


--
-- Name: vehicles vehicles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicles
    ADD CONSTRAINT vehicles_pkey PRIMARY KEY (id);


--
-- Name: blocked_dates update_blocked_dates_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_blocked_dates_updated_at BEFORE UPDATE ON public.blocked_dates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: bookings update_bookings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_bookings_updated_at BEFORE UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: clients update_clients_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_clients_updated_at BEFORE UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: drivers update_drivers_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_drivers_updated_at BEFORE UPDATE ON public.drivers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: faqs update_faqs_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_faqs_updated_at BEFORE UPDATE ON public.faqs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: portfolio update_portfolio_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_portfolio_updated_at BEFORE UPDATE ON public.portfolio FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: pricing_extras update_pricing_extras_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_pricing_extras_updated_at BEFORE UPDATE ON public.pricing_extras FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: promotions update_promotions_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_promotions_updated_at BEFORE UPDATE ON public.promotions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: service_inclusions update_service_inclusions_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_service_inclusions_updated_at BEFORE UPDATE ON public.service_inclusions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: site_settings update_site_settings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_site_settings_updated_at BEFORE UPDATE ON public.site_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: testimonials update_testimonials_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_testimonials_updated_at BEFORE UPDATE ON public.testimonials FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: vehicles update_vehicles_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_vehicles_updated_at BEFORE UPDATE ON public.vehicles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: audit_logs audit_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);


--
-- Name: bookings bookings_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id);


--
-- Name: notifications notifications_related_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_related_booking_id_fkey FOREIGN KEY (related_booking_id) REFERENCES public.bookings(id) ON DELETE SET NULL;


--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: portfolio_images portfolio_images_portfolio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolio_images
    ADD CONSTRAINT portfolio_images_portfolio_id_fkey FOREIGN KEY (portfolio_id) REFERENCES public.portfolio(id) ON DELETE CASCADE;


--
-- Name: user_roles user_roles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: faqs Admins can manage FAQs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage FAQs" ON public.faqs USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: bookings Admins can manage all bookings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage all bookings" ON public.bookings USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: clients Admins can manage all clients; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage all clients" ON public.clients USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: notifications Admins can manage all notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage all notifications" ON public.notifications USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: user_roles Admins can manage all roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage all roles" ON public.user_roles USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: blocked_dates Admins can manage blocked dates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage blocked dates" ON public.blocked_dates USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: drivers Admins can manage drivers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage drivers" ON public.drivers USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: pricing_extras Admins can manage extras; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage extras" ON public.pricing_extras USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: service_inclusions Admins can manage inclusions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage inclusions" ON public.service_inclusions USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: portfolio Admins can manage portfolio; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage portfolio" ON public.portfolio USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: portfolio_images Admins can manage portfolio images; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage portfolio images" ON public.portfolio_images USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: promotions Admins can manage promotions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage promotions" ON public.promotions USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: site_settings Admins can manage site settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage site settings" ON public.site_settings USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: testimonials Admins can manage testimonials; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage testimonials" ON public.testimonials USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: vehicles Admins can manage vehicles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage vehicles" ON public.vehicles USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: feedback_submissions Admins can view all feedback; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view all feedback" ON public.feedback_submissions FOR SELECT USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: audit_logs Admins can view audit logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view audit logs" ON public.audit_logs FOR SELECT USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: bookings Anyone can create bookings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can create bookings" ON public.bookings FOR INSERT WITH CHECK (true);


--
-- Name: feedback_submissions Anyone can submit feedback; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can submit feedback" ON public.feedback_submissions FOR INSERT WITH CHECK (true);


--
-- Name: faqs Anyone can view active FAQs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can view active FAQs" ON public.faqs FOR SELECT USING ((is_active = true));


--
-- Name: pricing_extras Anyone can view active extras; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can view active extras" ON public.pricing_extras FOR SELECT USING ((is_active = true));


--
-- Name: service_inclusions Anyone can view active inclusions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can view active inclusions" ON public.service_inclusions FOR SELECT USING ((is_active = true));


--
-- Name: promotions Anyone can view active promotions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can view active promotions" ON public.promotions FOR SELECT USING (((is_active = true) AND (valid_from <= CURRENT_DATE) AND (valid_until >= CURRENT_DATE)));


--
-- Name: testimonials Anyone can view active testimonials; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can view active testimonials" ON public.testimonials FOR SELECT USING ((is_active = true));


--
-- Name: vehicles Anyone can view available vehicles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can view available vehicles" ON public.vehicles FOR SELECT USING ((is_available = true));


--
-- Name: blocked_dates Anyone can view blocked dates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can view blocked dates" ON public.blocked_dates FOR SELECT USING (true);


--
-- Name: portfolio_images Anyone can view portfolio images; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can view portfolio images" ON public.portfolio_images FOR SELECT USING (true);


--
-- Name: portfolio Anyone can view published portfolio; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can view published portfolio" ON public.portfolio FOR SELECT USING ((is_published = true));


--
-- Name: site_settings Anyone can view site settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can view site settings" ON public.site_settings FOR SELECT USING (true);


--
-- Name: bookings Users can view their own bookings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their own bookings" ON public.bookings FOR SELECT USING ((customer_email = (( SELECT users.email
   FROM auth.users
  WHERE (users.id = auth.uid())))::text));


--
-- Name: clients Users can view their own client record; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their own client record" ON public.clients FOR SELECT USING ((email = (( SELECT users.email
   FROM auth.users
  WHERE (users.id = auth.uid())))::text));


--
-- Name: notifications Users can view their own notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their own notifications" ON public.notifications FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: user_roles Users can view their own roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their own roles" ON public.user_roles FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: audit_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: blocked_dates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.blocked_dates ENABLE ROW LEVEL SECURITY;

--
-- Name: bookings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

--
-- Name: clients; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

--
-- Name: drivers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.drivers ENABLE ROW LEVEL SECURITY;

--
-- Name: faqs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.faqs ENABLE ROW LEVEL SECURITY;

--
-- Name: feedback_submissions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.feedback_submissions ENABLE ROW LEVEL SECURITY;

--
-- Name: notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: portfolio; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.portfolio ENABLE ROW LEVEL SECURITY;

--
-- Name: portfolio_images; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.portfolio_images ENABLE ROW LEVEL SECURITY;

--
-- Name: pricing_extras; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pricing_extras ENABLE ROW LEVEL SECURITY;

--
-- Name: promotions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.promotions ENABLE ROW LEVEL SECURITY;

--
-- Name: service_inclusions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.service_inclusions ENABLE ROW LEVEL SECURITY;

--
-- Name: site_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: testimonials; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.testimonials ENABLE ROW LEVEL SECURITY;

--
-- Name: user_roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

--
-- Name: vehicles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--


