package com.example.todo_app;

import android.content.Context;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Prints a note through Android's print dialog, which also saves as PDF. The
 * page is laid out in its own off-screen web view, kept alive until the
 * print job has taken it.
 */
@CapacitorPlugin(name = "NotePrinter")
public class NotePrinterPlugin extends Plugin {
    private WebView printing;

    @PluginMethod
    public void print(PluginCall call) {
        String html = call.getString("html");
        String name = call.getString("name", "Note");
        if (html == null) {
            call.reject("Nothing to print.");
            return;
        }
        getActivity().runOnUiThread(() -> {
            WebView view = new WebView(getContext());
            view.getSettings().setJavaScriptEnabled(false);
            view.setWebViewClient(new WebViewClient() {
                @Override
                public void onPageFinished(WebView page, String url) {
                    PrintManager manager = (PrintManager) getContext().getSystemService(Context.PRINT_SERVICE);
                    PrintDocumentAdapter adapter = page.createPrintDocumentAdapter(name);
                    manager.print(name, adapter, new PrintAttributes.Builder().setMediaSize(PrintAttributes.MediaSize.ISO_A4).build());
                    printing = null;
                    call.resolve();
                }
            });
            printing = view;
            view.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
        });
    }
}
