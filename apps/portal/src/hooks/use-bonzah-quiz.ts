'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface BonzahQuizQuestion {
  id: string;
  question: string;
  options: string[];
  sort_order: number;
}

export interface QuizGradeResult {
  score: number;
  total: number;
  passed: boolean;
  results: Record<string, boolean>;
}

/**
 * Active quiz questions from the answer-omitting `bonzah_quiz_questions_public`
 * view. The correct answer index is never sent to the client — grading happens
 * server-side in the `bonzah-grade-quiz` edge function.
 */
export function useBonzahQuizQuestions() {
  return useQuery({
    queryKey: ['bonzah-quiz-questions'],
    queryFn: async (): Promise<BonzahQuizQuestion[]> => {
      const { data, error } = await supabase
        .from('bonzah_quiz_questions_public' as never)
        .select('id, question, options, sort_order')
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return ((data as unknown as BonzahQuizQuestion[]) ?? []).map((q) => ({
        ...q,
        options: Array.isArray(q.options) ? q.options : [],
      }));
    },
    staleTime: 5 * 60_000,
  });
}

/**
 * Grade the quiz via the edge function (authoritative — reads correct answers
 * server-side). `answers` maps questionId -> selected option index.
 */
export function useGradeBonzahQuiz() {
  return useMutation({
    mutationFn: async (answers: Record<string, number>): Promise<QuizGradeResult> => {
      const { data, error } = await supabase.functions.invoke('bonzah-grade-quiz', {
        body: { answers },
      });
      if (error) throw error;
      return data as QuizGradeResult;
    },
  });
}
