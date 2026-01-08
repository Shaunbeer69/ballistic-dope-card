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

            // Kill any recorder / SCO / communication routing
            try {
                am.stopBluetoothSco();
            } catch (Exception ignored) {
            }
            try {
                am.setBluetoothScoOn(false);
            } catch (Exception ignored) {
            }

            // CRITICAL: fully reset communication routing (Android 12+)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                try {
                    am.clearCommunicationDevice();
                } catch (Exception ignored) {
                }
            }

            // Force "communication" mode and speaker. Some devices keep routing to earpiece
            // after recording
            // unless we stay in COMMUNICATION while selecting the built-in speaker.
            try {
                am.setMode(AudioManager.MODE_IN_COMMUNICATION);
            } catch (Exception ignored) {
            }
            try {
                am.setSpeakerphoneOn(true);
            } catch (Exception ignored) {
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                try {
                    am.setMode(AudioManager.MODE_IN_COMMUNICATION);
                    for (AudioDeviceInfo d : am.getAvailableCommunicationDevices()) {
                        if (d != null && d.getType() == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER) {
                            am.setCommunicationDevice(d);
                            break;
                        }
                    }
                    am.setSpeakerphoneOn(true);
                    // return to normal for media

                } catch (Exception ignored) {
                }
            }

            // Force loudspeaker
            try {
                am.setSpeakerphoneOn(true);
            } catch (Exception ignored) {
            }

            // Explicitly select built-in speaker (Android 12+)
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
            // Never crash app due to routing
        }

        call.resolve();
    }
}
