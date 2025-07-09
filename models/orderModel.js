import mongoose from "mongoose";

const orderSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        minlength: 3,
        maxlength: 50,
        trim: true
    },
    email: {
        type: String,
        required: true,
        maxlength: 100,
        trim: true
    },
    phone: {
        type: String,
        required: true,
        trim: true
    },
    projectType: {
        type: String,
        required: true,
        trim: true
    },
    projectBudget: {
        type: String,
        required: true,
        trim: true
    },
    timeline: {
        type: Date,
        required: true,
        min: Date.now
    },
    projectDescription: {
        type: String,
        required: true,
        minlength: 10,
        maxlength: 500,
        trim: true
    },
    paymentReference: {
        type: String,
        required: true,
        trim: true
    },
    paymentMethod: {
        type: String,
        required: true,
        trim: true
    },
    files: [
        {
            name: {
                type: String,
                required: false,
            },
            url: {
                type: String,
                required: false,
            },
            type: {
                type: String,
                required: false,
            },
            public_id: {
                type: String,
                required: false,
            }
        }
    ],
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    avatar: {
        type: String,
        required: false,
        default: null
    },
    status: {
        type: String,
        enum: ['pending', 'completed'],
        default: 'pending'
    }
}, {
    timestamps: true
});

const Order = mongoose.model("Order", orderSchema);
export default Order;