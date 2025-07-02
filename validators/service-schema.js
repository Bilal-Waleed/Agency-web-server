import { z } from 'zod';

const serviceSchema = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters').max(100, 'Title is too long'),
  provider: z.string().min(3, 'Provider name must be at least 3 characters').max(100, 'Provider name is too long'),
  shortDesc: z.string().min(10, 'Short description must be at least 10 characters').max(200, 'Short description is too long'),
  fullDesc: z.string().min(50, 'Full description must be at least 50 characters').max(2000, 'Full description is too long'),
  image: z.string().optional(), // Made optional since file upload is handled separately
  minTime: z.string().min(1, 'Minimum time is required'),
  budget: z.string().min(1, 'Budget is required'),
  faqs: z
    .array(
      z.object({
        question: z.string().min(1, 'Question must be at least 1 character'),
        answer: z.string().min(1, 'Answer must be at least 1 character'),
      })
    )
    .optional(),
});

export default serviceSchema;