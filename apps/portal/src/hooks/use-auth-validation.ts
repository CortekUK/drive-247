import { useState, useCallback } from 'react';

export interface ValidationError {
  field: string;
  message: string;
}

export interface AuthFormData {
  email: string;
  password: string;
  rememberMe: boolean;
}

const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

export function useAuthValidation() {
  const [errors, setErrors] = useState<ValidationError[]>([]);
  const [touched, setTouched] = useState<Set<string>>(new Set());

  const validateEmail = useCallback((email: string): string | null => {
    if (!email.trim()) {
      return 'Email is required';
    }
    if (!EMAIL_REGEX.test(email)) {
      return 'Please enter a valid email address';
    }
    return null;
  }, []);

  const validatePassword = useCallback((password: string): string | null => {
    if (!password) {
      return 'Password is required';
    }
    if (password.length < 8) {
      return 'Password must be at least 8 characters';
    }
    return null;
  }, []);

  const validateField = useCallback((field: string, value: string): string | null => {
    switch (field) {
      case 'email':
        return validateEmail(value);
      case 'password':
        return validatePassword(value);
      default:
        return null;
    }
  }, [validateEmail, validatePassword]);

  const validateForm = useCallback((formData: Partial<AuthFormData>): ValidationError[] => {
    const newErrors: ValidationError[] = [];

    if (formData.email !== undefined) {
      const emailError = validateEmail(formData.email);
      if (emailError) {
        newErrors.push({ field: 'email', message: emailError });
      }
    }

    if (formData.password !== undefined) {
      const passwordError = validatePassword(formData.password);
      if (passwordError) {
        newErrors.push({ field: 'password', message: passwordError });
      }
    }

    return newErrors;
  }, [validateEmail, validatePassword]);

  const setFieldTouched = useCallback((field: string) => {
    setTouched(prev => new Set(prev).add(field));
  }, []);

  const getFieldError = useCallback((field: string): string | null => {
    if (!touched.has(field)) return null;
    const error = errors.find(e => e.field === field);
    return error?.message || null;
  }, [errors, touched]);

  const clearErrors = useCallback(() => {
    setErrors([]);
    setTouched(new Set());
  }, []);

  return {
    errors,
    touched,
    setErrors,
    validateField,
    validateForm,
    setFieldTouched,
    getFieldError,
    clearErrors
  };
}