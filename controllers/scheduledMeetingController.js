import ScheduledMeeting from '../models/scheduledMeetingModel.js';
import User from '../models/userModel.js';
import {
  sendScheduledMeetingEmail,
  sendMeetingAcceptedEmail,
  sendMeetingRescheduledEmail,
  sendMeetingReminderEmail,
  generateGoogleMeetLink,
} from './email-controller.js';

const deleteExpiredMeetings = async (io) => {
  try {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000); 

    const expiredMeetings = await ScheduledMeeting.find({
      $expr: {
        $lt: [
          { $dateFromString: { dateString: { $concat: ['$date', 'T', '$time'] } } },
          oneHourAgo,
        ],
      },
    });

    for (const meeting of expiredMeetings) {
      await ScheduledMeeting.deleteOne({ _id: meeting._id });
      io.to('adminRoom').emit('meetingDeleted', meeting._id);
    }

    return expiredMeetings.length;
  } catch (error) {
    console.error('Failed to delete expired meetings:', error.message);
    return 0;
  }
};

const sendMeetingReminders = async (io) => {
  try {
    const now = new Date();
    const inThirtyMinutes = new Date(now.getTime() + 30 * 60 * 1000);
    const fiveMinutesWindow = new Date(now.getTime() + 35 * 60 * 1000);

    const upcomingMeetings = await ScheduledMeeting.find({
      status: { $in: ['accepted', 'rescheduled'] },
      $expr: {
        $and: [
          {
            $gte: [
              { $dateFromString: { dateString: { $concat: ['$date', 'T', '$time'] } } },
              inThirtyMinutes,
            ],
          },
          {
            $lte: [
              { $dateFromString: { dateString: { $concat: ['$date', 'T', '$time'] } } },
              fiveMinutesWindow,
            ],
          },
        ],
      },
    })
      .populate('user', 'name email avatar')
      .populate('service', 'title');

    for (const meeting of upcomingMeetings) {
      try {
        const meetLink = await generateGoogleMeetLink({
          _id: meeting._id,
          userName: meeting.userName || meeting.user?.name,
          userEmail: meeting.userEmail || meeting.user?.email,
          serviceTitle: meeting.service.title,
          date: meeting.date,
          time: meeting.time,
        });

        await sendMeetingReminderEmail(
          meeting.userEmail || meeting.user?.email,
          meeting.userName || meeting.user?.name,
          meeting.service.title,
          meeting.date,
          meeting.time,
          meetLink
        );

        console.log(`Reminder sent for meeting ${meeting._id}`);
      } catch (error) {
        console.error(`Failed to send reminder for meeting ${meeting._id}:`, error.message);
      }
    }

    return upcomingMeetings.length;
  } catch (error) {
    console.error('Failed to send meeting reminders:', error.message);
    return 0;
  }
};

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

    const user = await User.findById(userId).select('name email avatar');
    if (!user) {
      return res.status(404).send({
        success: false,
        message: 'User not found',
      });
    }

    const meeting = new ScheduledMeeting({
      user: userId,
      userEmail: user.email,
      userName: user.name,
      userAvatar: user.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name)}`, 
      service: serviceId,
      date,
      time,
    });
    await meeting.save();

    const populatedMeeting = await ScheduledMeeting.findById(meeting._id)
      .populate('user', 'name email avatar')
      .populate('service', 'title');

    res.status(201).send({
      success: true,
      message: 'Meeting scheduled successfully',
      data: populatedMeeting,
    });

    io.to('adminRoom').emit('meetingChange', populatedMeeting);

    const admins = await User.find({ isAdmin: true }, 'email name');
    admins.forEach((admin) => {
      sendScheduledMeetingEmail(
        admin.email,
        admin.name,
        populatedMeeting.userName || populatedMeeting.user?.name,
        populatedMeeting.service.title,
        date,
        time
      ).catch((err) =>
        console.error(`Failed to send email to ${admin.email}:`, err.message)
      );
    });

    await deleteExpiredMeetings(io);
  } catch (error) {
    res.status(500).send({
      success: false,
      message: 'Failed to schedule meeting',
      details: error.message,
    });
  }
};

const getScheduledMeetings = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    const meetings = await ScheduledMeeting.find({
      $expr: {
        $gte: [
          { $dateFromString: { dateString: { $concat: ['$date', 'T', '$time'] } } },
          oneHourAgo,
        ],
      },
    })
      .populate('user', 'name email avatar')
      .populate('service', 'title')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    const formattedMeetings = meetings.map((meeting) => ({
      ...meeting._doc,
      user: meeting.user
        ? { name: meeting.user.name, email: meeting.user.email, avatar: meeting.user.avatar }
        : {
            name: meeting.userName,
            email: meeting.userEmail,
            avatar: meeting.userAvatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(meeting.userName)}`,
          },
    }));

    const total = await ScheduledMeeting.countDocuments({
      $expr: {
        $gte: [
          { $dateFromString: { dateString: { $concat: ['$date', 'T', '$time'] } } },
          oneHourAgo,
        ],
      },
    });
    const totalPages = Math.ceil(total / limit);

    res.status(200).send({
      success: true,
      message: 'Meetings fetched successfully',
      data: formattedMeetings,
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

const acceptMeeting = async (req, res) => {
  try {
    const io = req.app.get('io');

    const meeting = await ScheduledMeeting.findById(req.params.id)
      .populate('user', 'name email avatar')
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

    io.to('adminRoom').emit('meetingUI', {
      action: 'update',
      data: meeting,
    });

    sendMeetingAcceptedEmail(
      meeting.userEmail || meeting.user?.email,
      meeting.userName || meeting.user?.name,
      meeting.service.title,
      meeting.date,
      meeting.time
    ).catch((err) =>
      console.error('Failed to send accepted email:', err.message)
    );

    await deleteExpiredMeetings(io);
  } catch (error) {
    res.status(500).send({
      success: false,
      message: 'Failed to accept meeting',
      details: error.message,
    });
  }
};

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
      .populate('user', 'name email avatar')
      .populate('service', 'title');

    res.status(200).send({
      success: true,
      message: 'Meeting rescheduled successfully',
      data: populatedMeeting,
    });
    
    io.to('adminRoom').emit('meetingUI', {
      action: 'update',
      data: populatedMeeting,
    });

    sendMeetingRescheduledEmail(
      populatedMeeting.userEmail || populatedMeeting.user?.email,
      populatedMeeting.userName || populatedMeeting.user?.name,
      populatedMeeting.service.title,
      date,
      time
    ).catch((err) =>
      console.error('Failed to send rescheduled email:', err.message)
    );

    await deleteExpiredMeetings(io);
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
  rescheduleMeeting,
  deleteExpiredMeetings,
  sendMeetingReminders,
};