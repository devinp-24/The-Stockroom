// The phone-side answer to the website's drop zone.
//
// The pairs this app cannot find in either catalogue are exactly the ones with
// no convenient image link, and on a phone the photograph is usually already
// in your hand -- the shoe is on the shelf in front of you. So this offers the
// camera roll and the camera itself rather than a URL to paste, and sends the
// result through the same proxy route the web drop zone uses, which means a
// hand-added pair gets the same trim, resize and webp encoding as a catalogue
// photo and sits on the shelf looking like the rest.
import { useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Camera, ImagePlus, Check } from 'lucide-react-native';
import { colors, radius, spacing, fonts } from '../theme';
import { uploadPhoto, flipPhoto } from '../api';

// The picker's own compression. Left fairly high because the proxy is about to
// resize to 900px anyway: the only thing a lower number would buy is a smaller
// request, and the request crosses a LAN, not the internet.
const PICKER_QUALITY = 0.85;

export default function PhotoPicker({ value, onUploaded }) {
  const hasPhoto = !!value;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [mirror, setMirror] = useState(false);

  const run = async (requestPermission, launch, deniedMessage) => {
    setError('');
    try {
      // Asked before launching rather than left to the picker: on iOS from SDK
      // 54 the library prompt otherwise appears AFTER you have chosen a photo,
      // which reads as the app losing the one you just picked. Both requests
      // are documented as no-ops on web, so an undefined response there is a
      // yes, not a refusal.
      const permission = await requestPermission();
      if (permission && permission.granted === false) {
        setError(deniedMessage);
        return;
      }

      const result = await launch({
        mediaTypes: ['images'],
        quality: PICKER_QUALITY,
        // Asking the picker for base64 keeps the bytes in memory: the proxy
        // takes a data URL, so there is nothing to be gained by reading the
        // file back off disk afterwards.
        base64: true,
        exif: false,
      });
      if (result.canceled) return;

      const asset = result.assets?.[0];
      if (!asset?.base64) {
        setError('Could not read that photo.');
        return;
      }

      setBusy(true);
      const url = await uploadPhoto({
        base64: asset.base64,
        mimeType: asset.mimeType || 'image/jpeg',
        filename: asset.fileName || 'photo.jpg',
        mirror,
      });
      onUploaded(url);
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const pickFromLibrary = () =>
    run(
      ImagePicker.requestMediaLibraryPermissionsAsync,
      ImagePicker.launchImageLibraryAsync,
      'The Stockroom needs access to your photos to add one.',
    );

  const takePhoto = () =>
    run(
      ImagePicker.requestCameraPermissionsAsync,
      ImagePicker.launchCameraAsync,
      'The Stockroom needs access to the camera to take one.',
    );

  // With a photo already on screen the toggle flips THAT photo, rather than
  // quietly arming a preference for the next upload -- which is what it used
  // to do, and which read as the toggle being broken.
  const toggleMirror = async (next) => {
    setMirror(next);
    if (!value) return;

    setBusy(true);
    setError('');
    try {
      onUploaded(await flipPhoto(value));
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View>
      <View style={styles.row}>
        <Pressable
          style={({ pressed }) => [styles.btn, pressed && styles.btnPressed, busy && styles.btnBusy]}
          onPress={pickFromLibrary}
          disabled={busy}
        >
          {busy ? (
            <ActivityIndicator size="small" color={colors.textDim} />
          ) : (
            <ImagePlus size={15} color={colors.textDim} />
          )}
          <Text style={styles.btnText}>
            {busy ? 'Trimming…' : hasPhoto ? 'Replace photo' : 'Choose photo'}
          </Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.btn, pressed && styles.btnPressed, busy && styles.btnBusy]}
          onPress={takePhoto}
          disabled={busy}
        >
          <Camera size={15} color={colors.textDim} />
          <Text style={styles.btnText}>Take photo</Text>
        </Pressable>
      </View>

      {/* Off by default: an arbitrary photo has no known convention, unlike a
          supplier whose whole catalogue faces one way. */}
      <Pressable
        style={styles.flipRow}
        onPress={() => toggleMirror(!mirror)}
        disabled={busy}
        hitSlop={8}
      >
        <View style={[styles.checkbox, mirror && styles.checkboxOn]}>
          {mirror && <Check size={11} color={colors.onAccent} strokeWidth={3.5} />}
        </View>
        <Text style={styles.flipText}>{hasPhoto ? 'Flip this photo' : 'Flip to face right'}</Text>
      </Pressable>

      {!!error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  btn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  btnPressed: {
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  btnBusy: {
    opacity: 0.6,
  },
  btnText: {
    fontFamily: fonts.medium,
    fontSize: 13.5,
    color: colors.text,
  },
  flipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
    paddingVertical: spacing.xs,
  },
  checkbox: {
    width: 16,
    height: 16,
    borderRadius: radius.sm / 2,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  flipText: {
    fontFamily: fonts.regular,
    fontSize: 12.5,
    color: colors.textDim,
  },
  error: {
    fontFamily: fonts.regular,
    fontSize: 11.5,
    color: colors.danger,
    marginTop: spacing.sm,
  },
});
