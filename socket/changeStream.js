import User from "../models/userModel.js";
import Order from "../models/orderModel.js";
import Contact from "../models/contactModel.js";
import Service from "../models/serviceModel.js";
import ScheduledMeeting from "../models/scheduledMeetingModel.js";
import CancelRequest from "../models/cancelRequestModel.js";
import Notification from "../models/notificationModel.js";

export const setupChangeStream = (io) => {
  const collections = [
    { model: User, event: "userChange" },
    { model: Order, event: "orderChange" },
    { model: Contact, event: "contactChange" },
    { model: Service, event: "serviceChange" },
    { model: ScheduledMeeting, event: "meetingChange" },
    { model: CancelRequest, event: "cancelRequestChange" },
  ];

  const changeStreams = collections.map(({ model, event }) => {
    const changeStream = model.watch();

    changeStream.on("change", async (change) => {
      console.log(`Change detected in ${model.modelName}:`, change);

      const saveNotification = async (type, data) => {
        try {
          await Notification.create({
            type,
            data,
            createdAt: new Date(),
            viewed: false,
          });
          console.log(`Saved ${type} notification:`, data);
        } catch (error) {
          console.error(`Error saving ${type} notification:`, error);
        }
      };

      // ----------------- USER CHANGES -----------------
      if (event === "userChange") {
        const userId = change.documentKey._id;

        if (change.operationType === "delete") {
          const payload = {
            operationType: "delete",
            documentKey: { _id: userId },
            userId,
          };
          io.to(`user:${userId}`).emit("userChange", payload);
          io.to("adminRoom").emit("userChange", payload);
        } else if (change.operationType === "insert") {
          try {
            const newUser = await model.findById(userId).select("_id name email avatar isAdmin createdAt");
            if (newUser) {
              const payload = {
                operationType: "insert",
                fullDocument: newUser,
                userId,
              };
              io.to("adminRoom").emit("userChange", payload);
            }
          } catch (err) {
            console.error("Error fetching inserted user:", err);
          }
        } else if (change.operationType === "update") {
          try {
            const updatedUser = await model.findById(userId).select("_id name email avatar isAdmin createdAt");
            if (updatedUser) {
              const payload = {
                operationType: "update",
                documentKey: { _id: userId },
                fullDocument: updatedUser,
                userId,
              };
              io.to(`user:${userId}`).emit("userChange", payload);
              io.to("adminRoom").emit("userChange", payload);
            }
          } catch (err) {
            console.error("Error fetching updated user:", err);
          }
        }
      }

      // ----------------- CONTACT CHANGES -----------------
      if (event === "contactChange" && change.operationType === "insert") {
        try {
          const contactId = change.documentKey._id;
          const contact = await model.findById(contactId).select("name email message createdAt avatar");
          if (contact) {
            const payload = {
              operationType: change.operationType,
              ...contact.toObject(),
            };
            io.to("adminRoom").emit(event, payload);
            await saveNotification("contact", payload);
          }
        } catch (error) {
          console.error(`Error in contactChange:`, error);
        }
      }

      // ----------------- SERVICE CHANGES -----------------
      if (event === "serviceChange") {
        const serviceId = change.documentKey._id;

        if (change.operationType === "insert") {
          io.emit("serviceCreated", change.fullDocument);
        } else if (change.operationType === "update") {
          try {
            const updatedService = await model.findById(serviceId);
            if (updatedService) {
              io.emit("serviceUpdated", updatedService);
            }
          } catch (err) {
            console.error("Error fetching updated service:", err);
          }
        } else if (change.operationType === "delete") {
          io.emit("serviceDeleted", { id: serviceId });
        }
      }

      // ----------------- ORDER CHANGES -----------------
      if (event === "orderChange" && change.operationType === "insert") {
        try {
          const orderId = change.documentKey._id;
          const order = await model.findById(orderId)
            .populate("user", "name email avatar")
            .select("phone projectType projectBudget timeline projectDescription paymentReference paymentMethod files.name files.url createdAt")
            .lean();

          if (order) {
            const enhancedOrder = {
              ...order,
              filesList: order.files?.length > 0 ? order.files.map(f => f.name).join(', ') : 'None',
              user: order.user || {},
            };
            io.to("adminRoom").emit("orderChange", {
              operationType: "insert",
              fullDocument: enhancedOrder,
            });
            await saveNotification("order", {
              operationType: "insert",
              fullDocument: enhancedOrder,
            });
          }
        }
        catch (error) {
          console.error(`Error fetching order for insert:`, error);
        }
      }

      // ----------------- SCHEDULED MEETING CHANGES -----------------
      if (event === "meetingChange") {
        const meetingId = change.documentKey._id;

        if (["insert", "update"].includes(change.operationType)) {
          try {
            const meeting = await model.findById(meetingId)
              .populate("user", "name email avatar")
              .populate("service", "title")
              .lean();

            if (meeting) {
              io.to("adminRoom").emit("meetingChange", {
                operationType: change.operationType,
                ...meeting,
              });
              await saveNotification("meeting", {
                operationType: change.operationType,
                ...meeting,
              });
            }
          } catch (err) {
            console.error("Error fetching meeting:", err);
          }
        } else if (change.operationType === "delete") {
        }
      }

      // ----------------- CANCEL REQUEST CHANGES -----------------
      if (event === "cancelRequestChange" && change.operationType === "insert") {
        try {
          const requestId = change.documentKey._id;
          const cancelRequest = await model.findById(requestId)
            .populate({
              path: 'order',
              populate: { path: 'user', select: 'name email avatar' },
              select: 'phone projectType projectBudget timeline projectDescription paymentReference paymentMethod files.name files.url createdAt',
            })
            .lean();

          if (cancelRequest) {
            const enhancedRequest = {
              ...cancelRequest,
              order: {
                ...cancelRequest.order,
                filesList: cancelRequest.order.files?.length > 0 ? cancelRequest.order.files.map(f => f.name).join(', ') : 'None',
                user: cancelRequest.order.user || {},
              },
            };
            io.to("adminRoom").emit("cancelRequestChange", {
              operationType: "insert",
              fullDocument: enhancedRequest,
            });
            await saveNotification("cancelRequest", {
              operationType: "insert",
              fullDocument: enhancedRequest,
            });
          }
        } catch (error) {
          console.error(`Error fetching cancel request for insert:`, error);
        }
      }
    });

    changeStream.on("error", (error) => {
      console.error(`Change stream error for ${model.modelName}:`, error);
    });

    return changeStream;
  });

  io.on("connection", (socket) => {
    console.log(`Client connected: ${socket.id}`);

    socket.on("joinAdmin", () => {
      socket.join("adminRoom");
      console.log(`Client ${socket.id} joined adminRoom`);
    });

    socket.on("joinUserRoom", (room) => {
      socket.join(room);
      console.log(`Client ${socket.id} joined ${room}`);
    });

    socket.on("leaveAdmin", () => {
      socket.leave("adminRoom");
      console.log(`Client ${socket.id} left adminRoom`);
    });

    socket.on("disconnect", () => {
      console.log(`Client disconnected: ${socket.id}`);
    });
  });

  const closeChangeStreams = () => {
    changeStreams.forEach((changeStream, index) => {
      changeStream.close();
      console.log(`Closed change stream for ${collections[index].model.modelName}`);
    });
  };

  process.on("SIGINT", () => {
    closeChangeStreams();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    closeChangeStreams();
    process.exit(0);
  });
};