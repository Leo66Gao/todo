package com.example.todo_app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(GoogleAuthorizationPlugin.class);
        registerPlugin(AppChromePlugin.class);
        registerPlugin(NotePrinterPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
