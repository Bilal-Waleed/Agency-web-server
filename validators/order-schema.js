import z from 'zod';

const orderSchema = z.object({
    name: z.string().min(3, 'Name must be at least 3 characters').max(50, 'Name must be less than 50 characters'),
    email: z.string().email('Invalid email address').min(1, 'Email is required').max(100, 'Email must be less than 100 characters'),
    phone: z.string().regex(
        /^(\+?\d{1,4})?[\s.-]?(\(?\d{2,4}\)?[\s.-]?)?[\d\s.-]{6,12}$/,
        'Invalid phone number'
        ),
    projectType: z.enum(['Website', 'Mobile App', 'UI/UX', 'SEO', 'Bug Fixing', 'Wordpress'],
        {errorMap: () => ({ message: 'Project type is required' })}
    ),

    projectBudget: z.enum(['$100-$500', '$500-$1000', '$1000-$5000', '$5000+'], {
        errorMap: () => ({ message: 'Project budget is required' })
    }),
    timeline: z.string().refine(val => new Date(val) > new Date(), {
        message: 'Timeline must be in the future'
    }),
    projectDescription: z.string().min(10, 'Project description must be at least 10 characters').max(499, 'Project description must be less than 499 characters'),
    paymentReference: z.string().min(1, 'Payment reference is required'),
    paymentMethod: z.enum(['JazzCash', 'Bank Transfer', 'Stripe'], {
        errorMap: () => ({ message: 'Payment method is required' })
    }),
    file: z.any().optional()
});

export default orderSchema;