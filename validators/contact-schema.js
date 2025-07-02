import z from 'zod';

const contactSchema = z.object({
    name: z.string().min(1, 'Name is required').max(50, 'Name must be less than 50 characters'),
    email: z.string().email('Invalid email address').min(1, 'Email is required').max(100, 'Email must be less than 100 characters'),
    message: z.string().min(1, 'Message is required').max(500, 'Message must be less than 500 characters'),
});

export default contactSchema;
