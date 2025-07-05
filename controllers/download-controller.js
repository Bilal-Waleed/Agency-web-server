import Order from "../models/orderModel.js";
import User from "../models/userModel.js";
import AdmZip from "adm-zip";
import axios from "axios";
import { Document, Packer, Paragraph, Table, TableRow, TableCell, WidthType, TextRun } from "docx";

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

    // Generate .docx file buffer
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

    // Set response headers for download
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename=order_${orderId}.zip`);
    res.setHeader('Content-Length', zipBuffer.length);

    // Send ZIP file
    res.send(zipBuffer);
  } catch (error) {
    console.error("Error generating order ZIP:", error);
    res.status(500).json({ error: true, message: "Failed to generate order ZIP", details: error.message });
  }
};

export { downloadOrder };