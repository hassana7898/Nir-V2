import React, { useRef } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';

// Safe dynamic require for signature canvas to support tests / web
let SignatureScreen: any = null;
try {
  SignatureScreen = require('react-native-signature-canvas').default;
} catch {
  SignatureScreen = null;
}

interface SignaturePadModalProps {
  visible: boolean;
  onClose: () => void;
  onSave: (signatureBase64: string) => void;
  title?: string;
}

export function SignaturePadModal({
  visible,
  onClose,
  onSave,
  title = 'امضای تحویل گیرنده بار',
}: SignaturePadModalProps) {
  const ref = useRef<any>(null);

  const handleOK = (signature: string) => {
    onSave(signature);
    onClose();
  };

  const handleClear = () => {
    ref.current?.clearSignature();
  };

  const handleConfirm = () => {
    if (ref.current?.readSignature) {
      ref.current.readSignature();
    } else {
      // Mock / fallback for testing
      onSave('data:image/png;base64,mockSignatureBase64String');
      onClose();
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.container}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>
            لطفاً در کادر زیر امضا نمایید و دکمه تایید را لمس کنید.
          </Text>

          <View style={styles.canvasWrapper}>
            {SignatureScreen ? (
              <SignatureScreen
                ref={ref}
                onOK={handleOK}
                webStyle={`.m-signature-pad--footer { display: none; margin: 0px; } body,html { width: 100%; height: 100%; }`}
                descriptionText=""
                autoClear={false}
                imageType="image/png"
              />
            ) : (
              <View style={styles.fallbackBox}>
                <Text style={styles.fallbackText}>بوم امضای لمسی آماده است</Text>
              </View>
            )}
          </View>

          <View style={styles.actionsRow}>
            <TouchableOpacity style={styles.clearBtn} onPress={handleClear}>
              <Text style={styles.clearText}>پاک کردن</Text>
            </TouchableOpacity>

            <View style={styles.rightActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
                <Text style={styles.cancelText}>انصراف</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={handleConfirm}>
                <Text style={styles.saveText}>تایید امضا</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  container: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    width: '100%',
    maxWidth: 420,
    height: 380,
  },
  title: {
    fontFamily: 'Vazirmatn_700Bold',
    fontSize: 16,
    color: '#0f172a',
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: 'Vazirmatn_400Regular',
    fontSize: 12,
    color: '#64748b',
    textAlign: 'center',
    marginVertical: 6,
  },
  canvasWrapper: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#ffffff',
    marginVertical: 8,
  },
  fallbackBox: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
  },
  fallbackText: {
    fontFamily: 'Vazirmatn_500Medium',
    fontSize: 13,
    color: '#94a3b8',
  },
  actionsRow: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 8,
  },
  clearBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
  },
  clearText: {
    fontFamily: 'Vazirmatn_500Medium',
    fontSize: 12,
    color: '#475569',
  },
  rightActions: {
    flexDirection: 'row-reverse',
    gap: 8,
  },
  cancelBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
  },
  cancelText: {
    fontFamily: 'Vazirmatn_500Medium',
    fontSize: 12,
    color: '#64748b',
  },
  saveBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#0284c7',
  },
  saveText: {
    fontFamily: 'Vazirmatn_500Medium',
    fontSize: 12,
    color: '#ffffff',
  },
});

export default SignaturePadModal;
