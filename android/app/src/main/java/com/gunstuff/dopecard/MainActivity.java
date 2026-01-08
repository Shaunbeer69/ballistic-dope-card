package com.gunstuff.dopecard;

import android.content.Context;
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

            am.stopBluetoothSco();
            am.setBluetoothScoOn(false);

            am.setMode(AudioManager.MODE_NORMAL);
            am.setSpeakerphoneOn(true);

            setVolumeControlStream(AudioManager.STREAM_MUSIC);

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                try {
                    for (android.media.AudioDeviceInfo d : am.getAvailableCommunicationDevices()) {
                        if (d != null && d.getType() == android.media.AudioDeviceInfo.TYPE_BUILTIN_SPEAKER) {
                            am.setCommunicationDevice(d);
                            break;
                        }
                    }
                } catch (Exception ignored) {
                }
            }
        } catch (Exception ignored) {
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        forceSpeakerRoute();
    }

    @Override
    public void onResume() {
        super.onResume();
        forceSpeakerRoute();
    }
}
