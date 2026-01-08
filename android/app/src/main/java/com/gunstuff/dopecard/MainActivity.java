package com.gunstuff.dopecard;

import android.content.Context;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.Build;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private void forceSpeakerRoute() {
        try {
            AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            if (am == null)
                return;

            // Clear any “communication” routing that can stick after recording
            try {
                am.stopBluetoothSco();
            } catch (Exception ignored) {
            }
            try {
                am.setBluetoothScoOn(false);
            } catch (Exception ignored) {
            }

            try {
                am.setMode(AudioManager.MODE_NORMAL);
            } catch (Exception ignored) {
            }
            try {
                am.setSpeakerphoneOn(true);
            } catch (Exception ignored) {
            }

            // Volume buttons control media volume
            try {
                setVolumeControlStream(AudioManager.STREAM_MUSIC);
            } catch (Exception ignored) {
            }

            // Android 12+ stronger routing control
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                try {
                    for (AudioDeviceInfo d : am.getAvailableCommunicationDevices()) {
                        if (d != null && d.getType() == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER) {
                            am.setCommunicationDevice(d);
                            break;
                        }
                    }
                } catch (Exception ignored) {
                }
            }
        } catch (Exception ignored) {
            // Never crash app due to routing quirks
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Ensure JS calls to registerPlugin('AudioRoute') hit native code
        registerPlugin(AudioRoutePlugin.class);

        forceSpeakerRoute();
    }

    @Override
    public void onResume() {
        super.onResume();
        forceSpeakerRoute();
    }
}
