import Order from "../models/orderModel.js";
import User from "../models/userModel.js";
import AdmZip from "adm-zip";
import axios from "axios";
import { Document, Packer, Paragraph, Table, TableRow, TableCell, WidthType, TextRun } from "docx";
import { sendOrderCompletedEmail } from "./email-controller.js";
import mongoose from "mongoose";

const MAX_SINGLE_FILE_SIZE = 25 * 1024 * 1024; 
const MAX_TOTAL_SIZE = 25 * 1024 * 1024;  

const downloadOrder = async (req, res) => {
  try {
    const orderId = req.params.id;
    if (!orderId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ error: true, message: "Invalid order ID format" });
    }

    const order = await Order.findById(orderId)
      .populate("user", "name email avatar")
      .select("name email phone projectType projectBudget timeline projectDescription paymentReference paymentMethod files.url files.name createdAt avatar")
      .lean();

    if (!order) {
      return res.status(404).json({ error: true, message: "Order not found" });
    }

    const zip = new AdmZip();

    const doc = new Document({
      sections: [
        {
          properties: {},
          children: [
            new Paragraph({
              children: [
                new TextRun({
                  text: "Order Details",
                  bold: true,
                  size: 32,
                }),
              ],
              spacing: { after: 200 },
            }),
            new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              rows: [
                new TableRow({
                  children: [
                    new TableCell({
                      children: [new Paragraph("Order ID")],
                      width: { size: 30, type: WidthType.PERCENTAGE },
                    }),
                    new TableCell({
                      children: [new Paragraph(order._id.toString())],
                    }),
                  ],
                }),
                new TableRow({
                  children: [
                    new TableCell({
                      children: [new Paragraph("Name")],
                    }),
                    new TableCell({
                      children: [new Paragraph(order.name || "N/A")],
                    }),
                  ],
                }),
                new TableRow({
                  children: [
                    new TableCell({
                      children: [new Paragraph("Email")],
                    }),
                    new TableCell({
                      children: [new Paragraph(order.email || "N/A")],
                    }),
                  ],
                }),
                new TableRow({
                  children: [
                    new TableCell({
                      children: [new Paragraph("Phone")],
                    }),
                    new TableCell({
                      children: [new Paragraph(order.phone || "N/A")],
                    }),
                  ],
                }),
                new TableRow({
                  children: [
                    new TableCell({
                      children: [new Paragraph("Project Type")],
                    }),
                    new TableCell({
                      children: [new Paragraph(order.projectType || "N/A")],
                    }),
                  ],
                }),
                new TableRow({
                  children: [
                    new TableCell({
                      children: [new Paragraph("Project Budget")],
                    }),
                    new TableCell({
                      children: [new Paragraph(order.projectBudget || "N/A")],
                    }),
                  ],
                }),
                new TableRow({
                  children: [
                    new TableCell({
                      children: [new Paragraph("Timeline")],
                    }),
                    new TableCell({
                      children: [new Paragraph(new Date(order.timeline).toLocaleDateString() || "N/A")],
                    }),
                  ],
                }),
                new TableRow({
                  children: [
                    new TableCell({
                      children: [new Paragraph("Project Description")],
                    }),
                    new TableCell({
                      children: [new Paragraph(order.projectDescription || "N/A")],
                    }),
                  ],
                }),
                new TableRow({
                  children: [
                    new TableCell({
                      children: [new Paragraph("Payment Reference")],
                    }),
                    new TableCell({
                      children: [new Paragraph(order.paymentReference || "N/A")],
                    }),
                  ],
                }),
                new TableRow({
                  children: [
                    new TableCell({
                      children: [new Paragraph("Payment Method")],
                    }),
                    new TableCell({
                      children: [new Paragraph(order.paymentMethod || "N/A")],
                    }),
                  ],
                }),
                new TableRow({
                  children: [
                    new TableCell({
                      children: [new Paragraph("Created At")],
                    }),
                    new TableCell({
                      children: [new Paragraph(new Date(order.createdAt).toLocaleDateString() || "N/A")],
                    }),
                  ],
                }),
                new TableRow({
                  children: [
                    new TableCell({
                      children: [new Paragraph("Avatar URL")],
                    }),
                    new TableCell({
                      children: [new Paragraph(order.avatar || "N/A")],
                    }),
                  ],
                }),
                new TableRow({
                  children: [
                    new TableCell({
                      children: [new Paragraph("Files")],
                    }),
                    new TableCell({
                      children: [new Paragraph(order.files?.map(f => f.name).join(", ") || "None")],
                    }),
                  ],
                }),
              ],
            }),
          ],
        },
      ],
    });

    const docBuffer = await Packer.toBuffer(doc);
    zip.addFile("order_details.docx", docBuffer);

    for (let i = 0; i < order.files.length; i++) {
      const file = order.files[i];
      if (file.url && file.name) {
        try {
          const response = await axios.get(file.url, { responseType: 'arraybuffer' });
          zip.addFile(file.name, Buffer.from(response.data)); 
        } catch (error) {
          console.error(`Error fetching file ${file.name}:`, error.message);
        }
      }
    }

    const zipBuffer = zip.toBuffer();

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename=order_${orderId}.zip`);
    res.setHeader('Content-Length', zipBuffer.length);

    res.send(zipBuffer);
  } catch (error) {
    console.error("Error generating order ZIP:", error);
    res.status(500).json({ error: true, message: "Failed to generate order ZIP", details: error.message });
  }
};

const completeOrder = async (req, res) => {
  try {
    const orderId = req.params.id;
    const { message } = req.body;
    const files = req.files || [];

    for (let file of files) {
      if (file.size > MAX_SINGLE_FILE_SIZE) {
        return res.status(400).json({
          error: true,
          message: `${file.originalname} is larger than 25MB.`,
        });
      }
    }

    const totalSize = files.reduce((acc, file) => acc + file.size, 0);
    if (totalSize > MAX_TOTAL_SIZE) {
      return res.status(400).json({
        error: true,
        message: `Total size of all files exceeds 25MB.`,
      });
    }

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ error: true, message: "Invalid order ID" });
    }

    const order = await Order.findById(orderId).populate('user');
    if (!order) {
      return res.status(404).json({ error: true, message: "Order not found" });
    }

    let user = order.user;
    if (!user && order.email) {
      user = await User.findOne({ email: order.email });
      if (!user) {
        console.warn("User not found by email. Proceeding with fallback.");
      }
    }

    const userName = user?.name || order.name;
    const userEmail = user?.email || order.email;

    await Order.findByIdAndUpdate(orderId, { status: 'completed' });

    await sendOrderCompletedEmail(userEmail, userName, order.orderId, message, files);

    res.status(200).json({ error: false, message: "Order completed successfully" });
  } catch (error) {
    console.error("Error completing order:", error);
    res.status(500).json({
      error: true,
      message: "Failed to complete order",
      details: error.message,
    });
  }
};

export { downloadOrder, completeOrder };