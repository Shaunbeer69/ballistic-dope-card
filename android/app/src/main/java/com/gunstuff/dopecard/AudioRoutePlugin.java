package com.gunstuff.dopecard;

import android.content.Context;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.Build;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "AudioRoute")
public class AudioRoutePlugin extends Plugin {

    public void forceSpeaker(PluginCall call) {
        try {
            AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);

            if (am == null) {
                call.resolve();
                return;
            }

            // Kill any communication routing left by recorder
            try {
                am.stopBluetoothSco();
            } catch (Exception ignored) {
            }
            try {
                am.setBluetoothScoOn(false);
            } catch (Exception ignored) {
            }

            // Ensure media mode
            try {
                am.setMode(AudioManager.MODE_NORMAL);
            } catch (Exception ignored) {
            }

            // Force loudspeaker
            try {
                am.setSpeakerphoneOn(true);
            } catch (Exception ignored) {
            }

            // Android 12+ explicit device routing
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                try {
                    for (AudioDeviceInfo d : am.getAvailableCommunicationDevices()) {
                        if (d.getType() == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER) {
                            am.setCommunicationDevice(d);
                            break;
                        }
                    }
                } catch (Exception ignored) {
                }
            }

        } catch (Exception ignored) {
            // Never crash app for routing
        }

        call.resolve();
    }
}
