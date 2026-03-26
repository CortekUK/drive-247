export interface Lead {
  id: string;
  email: string;
  created_at: string;
  source: string;
}

export interface Feature {
  icon: string;
  title: string;
  description: string;
}

export interface TimelineStep {
  time: string;
  title: string;
  description: string;
}

export interface FAQItem {
  question: string;
  answer: string;
}

export interface FitItem {
  text: string;
}

export interface ProblemPoint {
  icon: string;
  title: string;
  description: string;
}

export interface SolutionCard {
  icon: string;
  title: string;
  description: string;
  badge: string;
}
