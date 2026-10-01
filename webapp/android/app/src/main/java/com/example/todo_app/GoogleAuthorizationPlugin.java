package com.example.todo_app;

import android.accounts.Account;
import android.app.Activity;
import androidx.activity.result.ActivityResult;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.IntentSenderRequest;
import androidx.activity.result.contract.ActivityResultContracts;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.common.api.Scope;
import java.util.ArrayList;
import java.util.List;

/**
 * Short-lived Google API access tokens (Google Calendar) for the signed-in
 * account. Once the user has granted a scope, tokens come back silently; the
 * consent screen only appears when `interactive` is set and it is needed.
 */
@CapacitorPlugin(name = "GoogleAuthorization")
public class GoogleAuthorizationPlugin extends Plugin {

    private ActivityResultLauncher<IntentSenderRequest> consentLauncher;
    private PluginCall consentCall;

    @Override
    public void load() {
        // Registered while the activity is being created, as Android requires.
        consentLauncher = getActivity().registerForActivityResult(
            new ActivityResultContracts.StartIntentSenderForResult(),
            this::handleConsent
        );
    }

    @PluginMethod
    public void authorize(PluginCall call) {
        List<Scope> scopes = new ArrayList<>();
        JSArray requested = call.getArray("scopes", new JSArray());
        try {
            for (Object scope : requested.toList()) scopes.add(new Scope(String.valueOf(scope)));
        } catch (Exception e) {
            call.reject("Invalid scopes.");
            return;
        }
        if (scopes.isEmpty()) {
            call.reject("No scopes requested.");
            return;
        }
        AuthorizationRequest.Builder builder = AuthorizationRequest.builder().setRequestedScopes(scopes);
        String email = call.getString("email");
        if (email != null && !email.isEmpty()) builder.setAccount(new Account(email, "com.google"));
        boolean interactive = Boolean.TRUE.equals(call.getBoolean("interactive", false));

        Identity.getAuthorizationClient(getActivity())
            .authorize(builder.build())
            .addOnSuccessListener(result -> {
                if (!result.hasResolution()) {
                    resolveToken(call, result);
                } else if (!interactive || result.getPendingIntent() == null) {
                    call.resolve(new JSObject());
                } else {
                    consentCall = call;
                    consentLauncher.launch(
                        new IntentSenderRequest.Builder(result.getPendingIntent().getIntentSender()).build()
                    );
                }
            })
            .addOnFailureListener(e -> call.reject(e.getMessage() != null ? e.getMessage() : "Authorization failed.", e));
    }

    private void handleConsent(ActivityResult result) {
        PluginCall call = consentCall;
        consentCall = null;
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK) {
            call.resolve(new JSObject());
            return;
        }
        try {
            AuthorizationResult authorization = Identity.getAuthorizationClient(getActivity())
                .getAuthorizationResultFromIntent(result.getData());
            resolveToken(call, authorization);
        } catch (ApiException e) {
            call.reject(e.getMessage() != null ? e.getMessage() : "Authorization failed.", e);
        }
    }

    private void resolveToken(PluginCall call, AuthorizationResult result) {
        JSObject out = new JSObject();
        if (result.getAccessToken() != null) out.put("accessToken", result.getAccessToken());
        call.resolve(out);
    }
}
