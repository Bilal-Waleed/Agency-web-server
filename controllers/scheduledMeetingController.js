import ScheduledMeeting from '../models/scheduledMeetingModel.js';
import User from '../models/userModel.js';
import {
  sendScheduledMeetingEmail,
  sendMeetingAcceptedEmail,
  sendMeetingRescheduledEmail
} from '../controllers/email-controller.js';

const createScheduledMeeting = async (req, res) => {
  try {
    const { userId, serviceId, date, time } = req.body;
    const io = req.app.get('io');

    const selectedDateTime = new Date(`${date}T${time}`);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);

    if (selectedDateTime < tomorrow) {
      return res.status(400).send({
        success: false,
        message: 'Meeting must be scheduled at least one day in the future',
      });
    }

    const existingMeetings = await ScheduledMeeting.find({ service: serviceId, date });
    const isConflict = existingMeetings.some((m) => {
      const existingTime = new Date(`${m.date}T${m.time}`);
      const diffInHours = Math.abs(existingTime - selectedDateTime) / (1000 * 60 * 60);
      return diffInHours < 1;
    });

    if (isConflict) {
      return res.status(409).send({
        success: false,
        message: 'Another meeting is already scheduled within 1 hour for this service.',
      });
    }

    // Save meeting
    const meeting = new ScheduledMeeting({ user: userId, service: serviceId, date, time });
    await meeting.save();

    const populatedMeeting = await ScheduledMeeting.findById(meeting._id)
      .populate('user', 'name email')
      .populate('service', 'title');

    res.status(201).send({
      success: true,
      message: 'Meeting scheduled successfully',
      data: populatedMeeting,
    });

    // Emit socket event
    io.to('adminRoom').emit('meetingChange', populatedMeeting);

    // Send emails in background
    const admins = await User.find({ isAdmin: true }, 'email name');
    admins.forEach((admin) => {
      sendScheduledMeetingEmail(
        admin.email,
        admin.name,
        populatedMeeting.user.name,
        populatedMeeting.service.title,
        date,
        time
      ).catch((err) =>
        console.error(`Failed to send email to ${admin.email}:`, err.message)
      );
    });

  } catch (error) {
    res.status(500).send({
      success: false,
      message: 'Failed to schedule meeting',
      details: error.message,
    });
  }
};

// GET MEETINGS
const getScheduledMeetings = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;

    const meetings = await ScheduledMeeting.find()
      .populate('user', 'name email avatar')
      .populate('service', 'title')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    const total = await ScheduledMeeting.countDocuments();
    const totalPages = Math.ceil(total / limit);

    res.status(200).send({
      success: true,
      message: 'Meetings fetched successfully',
      data: meetings,
      totalPages,
    });
  } catch (error) {
    res.status(500).send({
      success: false,
      message: 'Failed to fetch meetings',
      details: error.message,
    });
  }
};

// ACCEPT MEETING
const acceptMeeting = async (req, res) => {
  try {
    const io = req.app.get('io');

    const meeting = await ScheduledMeeting.findById(req.params.id)
      .populate('user', 'name email')
      .populate('service', 'title');

    if (!meeting) {
      return res.status(404).send({ success: false, message: 'Meeting not found' });
    }

    meeting.status = 'accepted';
    await meeting.save();

    res.status(200).send({
      success: true,
      message: 'Meeting accepted successfully',
      data: meeting,
    });

    io.to('adminRoom').emit('meetingChange', meeting);

    sendMeetingAcceptedEmail(
      meeting.user.email,
      meeting.user.name,
      meeting.service.title,
      meeting.date,
      meeting.time
    ).catch((err) =>
      console.error('Failed to send accepted email:', err.message)
    );

  } catch (error) {
    res.status(500).send({
      success: false,
      message: 'Failed to accept meeting',
      details: error.message,
    });
  }
};

// RESCHEDULE MEETING
const rescheduleMeeting = async (req, res) => {
  try {
    const { date, time } = req.body;
    const io = req.app.get('io');

    const selectedDateTime = new Date(`${date}T${time}`);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);

    if (selectedDateTime < tomorrow) {
      return res.status(400).send({
        success: false,
        message: 'New meeting time must be at least one day in the future',
      });
    }

    const meeting = await ScheduledMeeting.findById(req.params.id);
    if (!meeting) {
      return res.status(404).send({ success: false, message: 'Meeting not found' });
    }

    const existingMeetings = await ScheduledMeeting.find({
      service: meeting.service,
      date,
      _id: { $ne: meeting._id },
    });

    const isConflict = existingMeetings.some((m) => {
      const existingTime = new Date(`${m.date}T${m.time}`);
      const diffInHours = Math.abs(existingTime - selectedDateTime) / (1000 * 60 * 60);
      return diffInHours < 1;
    });

    if (isConflict) {
      return res.status(409).send({
        success: false,
        message: 'Another meeting is already scheduled within 1 hour for this service.',
      });
    }

    meeting.date = date;
    meeting.time = time;
    meeting.status = 'rescheduled';
    await meeting.save();

    const populatedMeeting = await ScheduledMeeting.findById(meeting._id)
      .populate('user', 'name email')
      .populate('service', 'title');

    res.status(200).send({
      success: true,
      message: 'Meeting rescheduled successfully',
      data: populatedMeeting,
    });

    io.to('adminRoom').emit('meetingChange', populatedMeeting);

    sendMeetingRescheduledEmail(
      populatedMeeting.user.email,
      populatedMeeting.user.name,
      populatedMeeting.service.title,
      date,
      time
    ).catch((err) =>
      console.error('Failed to send rescheduled email:', err.message)
    );

  } catch (error) {
    res.status(500).send({
      success: false,
      message: 'Failed to reschedule meeting',
      details: error.message,
    });
  }
};

export {
  createScheduledMeeting,
  getScheduledMeetings,
  acceptMeeting,
  rescheduleMeeting
};
