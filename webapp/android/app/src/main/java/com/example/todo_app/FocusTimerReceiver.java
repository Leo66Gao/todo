package com.example.todo_app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * The focus notification's buttons, the alarm at the end of each round, and
 * the phone restarting or the app updating (both drop the alarm and notification).
 */
public class FocusTimerReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || intent.getAction() == null) return;
        String action = intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(action) || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) {
            FocusTimer.restore(context);
        } else {
            FocusTimer.handle(context, action);
        }
    }
}
