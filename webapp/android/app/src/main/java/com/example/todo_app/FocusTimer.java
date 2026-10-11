package com.example.todo_app;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.SystemClock;
import android.widget.RemoteViews;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The focus timer on the phone, outside the web view: an ongoing notification
 * with a live countdown (Android ticks it, so it runs with the app closed),
 * Pause/Resume and Stop buttons, and an alarm at the end of each round that
 * alerts and moves on to the next round. The app sends the session here
 * whenever it changes, and reads back what was done from the notification.
 *
 * State (JSON): title, blocks [{kind: "focus"|"break", ms}], index, endsAt
 * (epoch ms while running, else 0), left (ms while paused), paused.
 */
final class FocusTimer {
    static final String ACTION_END = "com.example.todo_app.FOCUS_END";
    static final String ACTION_PAUSE = "com.example.todo_app.FOCUS_PAUSE";
    static final String ACTION_RESUME = "com.example.todo_app.FOCUS_RESUME";
    static final String ACTION_STOP = "com.example.todo_app.FOCUS_STOP";
    static final String EXTRA_OPEN = "focusOpen";

    private static final String PREFS = "focus_timer";
    private static final String KEY_STATE = "state";
    private static final String KEY_REV = "rev";
    private static final String CHANNEL_ONGOING = "focus_timer";
    private static final String CHANNEL_ALERT = "focus_alerts";
    private static final int ONGOING_ID = 1_998_000_001;
    private static final int ALERT_ID = 1_998_000_002;
    private static final int COLOR = 0xFF2F5FD0;

    private FocusTimer() {}

    // ---------------------------------------------------------------------
    // State

    static JSONObject load(Context context) {
        String raw = prefs(context).getString(KEY_STATE, null);
        if (raw == null) return null;
        try {
            return new JSONObject(raw);
        } catch (JSONException e) {
            return null;
        }
    }

    /** Changes made from the notification since the app last looked (the app compares it). */
    static int rev(Context context) {
        return prefs(context).getInt(KEY_REV, 0);
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static void save(Context context, JSONObject state, boolean fromNotification) {
        SharedPreferences.Editor editor = prefs(context).edit();
        if (state == null) editor.remove(KEY_STATE);
        else editor.putString(KEY_STATE, state.toString());
        if (fromNotification) editor.putInt(KEY_REV, rev(context) + 1);
        editor.apply();
    }

    /** The app's session (or null when there is none): shown, and its round ends scheduled. */
    static void apply(Context context, JSONObject state) {
        // With the app open it moves on at a round's end at the same moment as
        // the alarm here; the alert for that round still comes, whichever is first.
        JSONObject old = load(context);
        long now = System.currentTimeMillis();
        long oldEnd = old == null ? 0 : old.optLong("endsAt");
        if (old != null && !old.optBoolean("paused") && oldEnd > 0 && oldEnd <= now + 1500) {
            try {
                roundEnded(context, old, now);
            } catch (JSONException ignored) {
                // Nothing to announce.
            }
        }
        save(context, state, false);
        refresh(context, state);
    }

    /**
     * After a restart (or an app update) Android has dropped the alarm and the
     * notification: put them back, first catching up on rounds that ended meanwhile.
     */
    static void restore(Context context) {
        JSONObject state = load(context);
        if (state == null) return;
        long now = System.currentTimeMillis();
        if (!state.optBoolean("paused") && state.optLong("endsAt") <= now + 1500) {
            try {
                roundEnded(context, state, now);
            } catch (JSONException e) {
                refresh(context, state);
            }
        } else {
            refresh(context, state);
        }
        FocusTimerPlugin.changed();
    }

    private static void refresh(Context context, JSONObject state) {
        cancelEnd(context);
        if (state == null) {
            NotificationManagerCompat.from(context).cancel(ONGOING_ID);
            return;
        }
        show(context, state);
        long endsAt = state.optLong("endsAt", 0);
        if (!state.optBoolean("paused") && endsAt > 0) scheduleEnd(context, endsAt);
    }

    // ---------------------------------------------------------------------
    // Buttons and round ends

    static void handle(Context context, String action) {
        JSONObject state = load(context);
        if (state == null) {
            NotificationManagerCompat.from(context).cancel(ONGOING_ID);
            return;
        }
        long now = System.currentTimeMillis();
        try {
            switch (action) {
                case ACTION_PAUSE:
                    if (state.optBoolean("paused")) return;
                    state.put("left", Math.max(0, state.optLong("endsAt") - now));
                    state.put("endsAt", 0);
                    state.put("paused", true);
                    save(context, state, true);
                    refresh(context, state);
                    break;
                case ACTION_RESUME:
                    if (!state.optBoolean("paused")) return;
                    state.put("endsAt", now + state.optLong("left"));
                    state.put("left", 0);
                    state.put("paused", false);
                    save(context, state, true);
                    refresh(context, state);
                    break;
                case ACTION_STOP:
                    save(context, null, true);
                    refresh(context, null);
                    break;
                case ACTION_END:
                    roundEnded(context, state, now);
                    break;
                default:
                    return;
            }
        } catch (JSONException e) {
            return;
        }
        FocusTimerPlugin.changed();
    }

    /** A round is over: alert, and go on to the next one (or finish). */
    private static void roundEnded(Context context, JSONObject state, long now) throws JSONException {
        if (state.optBoolean("paused")) return;
        long endsAt = state.optLong("endsAt");
        // Woken early (or by a stale alarm): wait for the real end.
        if (endsAt > now + 1500) {
            scheduleEnd(context, endsAt);
            return;
        }
        JSONArray blocks = state.optJSONArray("blocks");
        int count = blocks == null ? 1 : blocks.length();
        int index = state.optInt("index");
        String ended = kindAt(blocks, index);
        // Catch up on rounds that ended while the phone was asleep.
        while (index < count - 1 && endsAt <= now + 1500) {
            index++;
            endsAt += blocks.getJSONObject(index).optLong("ms");
            if (endsAt <= now + 1500) ended = kindAt(blocks, index);
        }
        String title = state.optString("title");
        if (endsAt <= now + 1500) {
            // The whole session is done.
            alert(context, "Time’s up", title.isEmpty() ? "Your focus session has ended." : title);
            save(context, null, false);
            refresh(context, null);
            return;
        }
        state.put("index", index);
        state.put("endsAt", endsAt);
        save(context, state, false);
        if ("break".equals(ended)) {
            alert(context, "Break’s over", "Back to " + (title.isEmpty() ? "it" : title) + ".");
        } else {
            long breakMs = blocks.getJSONObject(index).optLong("ms");
            alert(context,
                    "Take " + Math.max(1, Math.round(breakMs / 60000.0)) + " minutes",
                    "Round done" + (title.isEmpty() ? "" : " on " + title) + ". A short break starts now.");
        }
        refresh(context, state);
    }

    private static String kindAt(JSONArray blocks, int index) {
        if (blocks == null || index >= blocks.length()) return "focus";
        return blocks.optJSONObject(index) == null ? "focus" : blocks.optJSONObject(index).optString("kind", "focus");
    }

    private static PendingIntent endIntent(Context context, int flags) {
        Intent intent = new Intent(context, FocusTimerReceiver.class).setAction(ACTION_END);
        return PendingIntent.getBroadcast(context, 0, intent, flags | PendingIntent.FLAG_IMMUTABLE);
    }

    private static void scheduleEnd(Context context, long at) {
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms == null) return;
        PendingIntent pending = endIntent(context, PendingIntent.FLAG_UPDATE_CURRENT);
        boolean exact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarms.canScheduleExactAlarms();
        if (exact) alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending);
        else alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending);
    }

    private static void cancelEnd(Context context) {
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        PendingIntent pending = endIntent(context, PendingIntent.FLAG_NO_CREATE);
        if (alarms != null && pending != null) alarms.cancel(pending);
    }

    // ---------------------------------------------------------------------
    // Notifications

    private static void channels(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;
        // Shown with your other notifications (not under "Silent"), without a sound.
        manager.deleteNotificationChannel("focus");
        NotificationChannel ongoing = new NotificationChannel(CHANNEL_ONGOING, "Focus timer", NotificationManager.IMPORTANCE_DEFAULT);
        ongoing.setDescription("The running focus timer, with its countdown.");
        ongoing.setSound(null, null);
        ongoing.enableVibration(false);
        ongoing.setShowBadge(false);
        manager.createNotificationChannel(ongoing);
        NotificationChannel alerts = new NotificationChannel(CHANNEL_ALERT, "Focus rounds", NotificationManager.IMPORTANCE_HIGH);
        alerts.setDescription("When a focus round or a break ends.");
        manager.createNotificationChannel(alerts);
    }

    private static PendingIntent openApp(Context context) {
        Intent intent = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (intent == null) intent = new Intent(context, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
        intent.putExtra(EXTRA_OPEN, true);
        return PendingIntent.getActivity(context, 7, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static PendingIntent button(Context context, String action, int code) {
        Intent intent = new Intent(context, FocusTimerReceiver.class).setAction(action);
        return PendingIntent.getBroadcast(context, code, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static String clock(long at) {
        return new SimpleDateFormat("HH.mm", Locale.getDefault()).format(new Date(at));
    }

    private static void show(Context context, JSONObject state) {
        NotificationManagerCompat manager = NotificationManagerCompat.from(context);
        if (!manager.areNotificationsEnabled()) return;
        channels(context);
        JSONArray blocks = state.optJSONArray("blocks");
        int count = blocks == null ? 1 : blocks.length();
        int index = Math.min(state.optInt("index"), Math.max(0, count - 1));
        boolean onBreak = "break".equals(kindAt(blocks, index));
        boolean paused = state.optBoolean("paused");
        long now = System.currentTimeMillis();
        long left = paused ? state.optLong("left") : Math.max(0, state.optLong("endsAt") - now);
        String task = state.optString("title");

        // Rounds of focus: this one's number and how many there are.
        int rounds = 0;
        int round = 0;
        for (int i = 0; i < count; i++) {
            if (!"break".equals(kindAt(blocks, i))) {
                rounds++;
                if (i <= index) round = rounds;
            }
        }
        String title = onBreak ? "Break" : (task.isEmpty() ? "Focus" : task);
        StringBuilder detail = new StringBuilder();
        if (paused) detail.append("Paused");
        else if (onBreak) detail.append("back at ").append(clock(now + left));
        else detail.append(index < count - 1 ? "break at " : "ends ").append(clock(now + left));
        if (rounds > 1) detail.append(" · ").append(onBreak ? "round " + (round + 1) + " next" : "round " + round + " of " + rounds);

        RemoteViews view = new RemoteViews(context.getPackageName(), R.layout.notification_focus);
        view.setTextViewText(R.id.focus_title, title);
        view.setTextViewText(R.id.focus_detail, detail.toString());
        view.setChronometer(R.id.focus_clock, SystemClock.elapsedRealtime() + left, null, !paused);
        view.setChronometerCountDown(R.id.focus_clock, true);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ONGOING)
                .setSmallIcon(R.drawable.ic_stat_todo)
                .setColor(COLOR)
                .setContentTitle(title)
                .setContentText(detail.toString())
                .setCustomContentView(view)
                .setStyle(new NotificationCompat.DecoratedCustomViewStyle())
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setShowWhen(false)
                .setSilent(true)
                .setCategory(NotificationCompat.CATEGORY_STOPWATCH)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setContentIntent(openApp(context))
                .addAction(0, paused ? "Resume" : "Pause", button(context, paused ? ACTION_RESUME : ACTION_PAUSE, 1))
                .addAction(0, "Stop", button(context, ACTION_STOP, 2));
        try {
            manager.notify(ONGOING_ID, builder.build());
        } catch (SecurityException ignored) {
            // Notifications not allowed: the timer still runs in the app.
        }
    }

    private static void alert(Context context, String title, String body) {
        NotificationManagerCompat manager = NotificationManagerCompat.from(context);
        if (!manager.areNotificationsEnabled()) return;
        channels(context);
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ALERT)
                .setSmallIcon(R.drawable.ic_stat_todo)
                .setColor(COLOR)
                .setContentTitle(title)
                .setContentText(body)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setAutoCancel(true)
                .setContentIntent(openApp(context));
        try {
            manager.notify(ALERT_ID, builder.build());
        } catch (SecurityException ignored) {
            // Not allowed to notify.
        }
    }
}
