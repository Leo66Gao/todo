package com.example.todo_app;

import android.content.Intent;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.lang.ref.WeakReference;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The app's side of the focus timer (see FocusTimer): it sends the session
 * whenever it changes, reads back what was done from the notification, and
 * hears when the notification is tapped.
 */
@CapacitorPlugin(name = "FocusTimer")
public class FocusTimerPlugin extends Plugin {
    private static WeakReference<FocusTimerPlugin> current = new WeakReference<>(null);
    private boolean openedFromNotification;

    @Override
    public void load() {
        current = new WeakReference<>(this);
        Intent intent = getActivity().getIntent();
        openedFromNotification = intent != null && intent.getBooleanExtra(FocusTimer.EXTRA_OPEN, false);
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        if (intent != null && intent.getBooleanExtra(FocusTimer.EXTRA_OPEN, false)) notifyListeners("open", new JSObject());
    }

    /** A button in the notification changed the session, or a round ended. */
    static void changed() {
        FocusTimerPlugin plugin = current.get();
        if (plugin != null) plugin.notifyListeners("changed", new JSObject());
    }

    @PluginMethod
    public void update(PluginCall call) {
        JSObject state = call.getObject("state", null);
        FocusTimer.apply(getContext(), state);
        call.resolve();
    }

    @PluginMethod
    public void get(PluginCall call) {
        JSObject result = new JSObject();
        result.put("rev", FocusTimer.rev(getContext()));
        JSONObject state = FocusTimer.load(getContext());
        try {
            result.put("state", state == null ? JSONObject.NULL : JSObject.fromJSONObject(state));
        } catch (JSONException e) {
            result.put("state", JSONObject.NULL);
        }
        result.put("opened", openedFromNotification);
        openedFromNotification = false;
        call.resolve(result);
    }
}
