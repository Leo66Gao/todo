package com.example.todo_app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** The focus notification's buttons, and the alarm at the end of each round. */
public class FocusTimerReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || intent.getAction() == null) return;
        FocusTimer.handle(context, intent.getAction());
    }
}
