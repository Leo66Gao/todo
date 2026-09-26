package com.example.todo_app;

import android.graphics.Color;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The window colour behind the web view. With a current WebView the app draws
 * edge to edge and this never shows; older WebViews are inset below the status
 * bar and above the navigation bar instead, and those strips show this colour,
 * so the app keeps it matched to what's at the top of the page.
 */
@CapacitorPlugin(name = "AppChrome")
public class AppChromePlugin extends Plugin {

    @PluginMethod
    public void setBackground(PluginCall call) {
        String color = call.getString("color");
        final int parsed;
        try {
            parsed = Color.parseColor(color);
        } catch (Exception e) {
            call.reject("Invalid colour.");
            return;
        }
        getActivity().runOnUiThread(() -> {
            getActivity().getWindow().getDecorView().setBackgroundColor(parsed);
            if (getBridge().getWebView().getParent() instanceof android.view.View) {
                ((android.view.View) getBridge().getWebView().getParent()).setBackgroundColor(parsed);
            }
            call.resolve();
        });
    }
}
