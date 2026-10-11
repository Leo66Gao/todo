package com.example.todo_app;

import android.os.Build;
import android.os.Bundle;
import android.view.Display;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(GoogleAuthorizationPlugin.class);
        registerPlugin(AppChromePlugin.class);
        registerPlugin(NotePrinterPlugin.class);
        registerPlugin(FocusTimerPlugin.class);
        super.onCreate(savedInstanceState);
        preferFastestRefreshRate();
    }

    /**
     * Asks for the screen's fastest refresh rate (90 or 120 Hz where the phone
     * has it) at the current resolution, so scrolling and animations run at it
     * instead of the 60 Hz some phones default apps to.
     */
    private void preferFastestRefreshRate() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return;
        Display display = getWindowManager().getDefaultDisplay();
        Display.Mode current = display.getMode();
        Display.Mode best = current;
        for (Display.Mode mode : display.getSupportedModes()) {
            if (mode.getPhysicalWidth() == current.getPhysicalWidth()
                    && mode.getPhysicalHeight() == current.getPhysicalHeight()
                    && mode.getRefreshRate() > best.getRefreshRate()) {
                best = mode;
            }
        }
        WindowManager.LayoutParams params = getWindow().getAttributes();
        params.preferredDisplayModeId = best.getModeId();
        getWindow().setAttributes(params);
    }
}
