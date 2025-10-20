import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
} from 'react-native';
import { Speech } from 'expo-speech';
import axios from 'axios';
import { Ionicons } from '@expo/vector-icons';

// Polyfill for Web Speech API
const SpeechRecognition =
  typeof window !== 'undefined' &&
  (window.SpeechRecognition || window.webkitSpeechRecognition);

const App = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [conversationHistory, setConversationHistory] = useState([]);
  const [recognition, setRecognition] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const historyRef = useRef([]);
  const processedResultsRef = useRef(0);
  const isSpeakingRef = useRef(false);
  const isIgnoringResultsRef = useRef(false);
  const voiceEnabledRef = useRef(false);
  const shouldBeRecordingRef = useRef(false);

  useEffect(() => {
    if (SpeechRecognition) {
      const recognitionInstance = new SpeechRecognition();
      recognitionInstance.continuous = true;
      recognitionInstance.interimResults = false;
      recognitionInstance.lang = 'es-ES';

      recognitionInstance.onstart = () => {
        console.log('Speech started');
        setIsRecording(true);
      };

      recognitionInstance.onend = () => {
        console.log('Speech ended, shouldBeRecording:', shouldBeRecordingRef.current);
        setIsRecording(false);
        
        // Restart recognition if user wants to keep recording
        // and we're not speaking or ignoring results
        if (shouldBeRecordingRef.current && !isSpeakingRef.current && !isIgnoringResultsRef.current) {
          console.log('Restarting recognition automatically');
          setTimeout(() => {
            try {
              recognitionInstance.start();
              console.log('Recognition restarted successfully');
            } catch (e) {
              console.error('Error restarting recognition:', e);
            }
          }, 100);
        }
      };

      recognitionInstance.onresult = (e) => {
        if (isSpeakingRef.current || isIgnoringResultsRef.current) return;
        const localHistory = [...historyRef.current];
        const startIndex = processedResultsRef.current;
        for (let i = 0; i < e.results.length; i++) {
          const result = e.results[i];
          if (i >= startIndex && result.isFinal) {
            const transcript = result[0].transcript;
            localHistory.push(`Usuario: ${transcript}`);

            // Check for trigger phrase on each final result
            if (!isProcessing && transcript.toLowerCase().includes('dylan')) {
              setIsProcessing(true);
              handleTrigger(transcript, [...localHistory]);
            }
            processedResultsRef.current++;
          }
        }
        setConversationHistory(localHistory);
        historyRef.current = localHistory;
      };

      recognitionInstance.onerror = (e) => {
        console.error('Speech error:', e);
      };

      setRecognition(recognitionInstance);
    }



    return () => {
      if (recognition) {
        recognition.abort();
      }
    };
  }, []);

  const startRecording = () => {
    if (recognition) {
      shouldBeRecordingRef.current = true;
      try {
        recognition.start();
        console.log('Recording started');
      } catch (e) {
        console.error('Error starting recording:', e);
        // If error is "already started", it means we're already recording
        if (e.message && e.message.includes('already started')) {
          console.log('Recognition already started, continuing...');
        } else {
          // For other errors, try to reset
          console.log('Attempting to reset recognition...');
          try {
            recognition.stop();
            setTimeout(() => {
              try {
                recognition.start();
              } catch (restartError) {
                console.error('Failed to restart:', restartError);
              }
            }, 300);
          } catch (stopError) {
            console.error('Failed to stop and reset:', stopError);
          }
        }
      }
    }
  };

  const stopRecording = () => {
    if (recognition) {
      shouldBeRecordingRef.current = false;
      try {
        recognition.stop();
        console.log('Recording stopped');
      } catch (e) {
        console.error('Error stopping recording:', e);
      }
    }
  };

  const handleTrigger = async (triggerText, history) => {
    try {
      const res = await axios.post('https://dylan-backend.onrender.com/generate_response', {
        conversation_history: history,
        trigger_text: triggerText,
      });

      const dylanResponse = res.data.response;
      const newHistory = [...history, `Dylan: ${dylanResponse}`];
      setConversationHistory(newHistory);
      historyRef.current = newHistory;

      console.log('Voice enabled state:', voiceEnabledRef.current);
      
      if (voiceEnabledRef.current) {
        console.log('Starting voice response...');
        // Temporarily stop recording while speaking
        const wasRecording = shouldBeRecordingRef.current;
        if (recognition && isRecording) {
          recognition.stop();
        }
        setIsSpeaking(true);
        isSpeakingRef.current = true;
        // Speak the response
        speakText(dylanResponse, () => {
          console.log('Voice response completed');
          setIsSpeaking(false);
          isSpeakingRef.current = false;
          setIsProcessing(false);
          
          // Ignore recognition results briefly to prevent capturing echo
          isIgnoringResultsRef.current = true;
          setTimeout(() => {
            isIgnoringResultsRef.current = false;
            console.log('Ready to resume recording...');
          }, 1000);
          
          // Restart recording after speaking only if user wanted to record
          if (recognition && wasRecording) {
            setTimeout(() => {
              try {
                recognition.start();
                console.log('Recording restarted after speech');
              } catch (e) {
                console.error('Error restarting recording:', e);
              }
            }, 1500);
          }
        });
      } else {
        console.log('Voice disabled, skipping speech');
        // Voice disabled, just finish processing
        setIsProcessing(false);
      }
    } catch (error) {
      console.error('Error calling backend:', error);
      alert('No se pudo obtener la respuesta.');
      setIsProcessing(false);
    }
  };

  const speakText = (text, callback) => {
    console.log('Speaking text:', text);
    console.log('Voice enabled ref:', voiceEnabledRef.current);
    
    // Use Web Speech API for browser
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'es-ES';
      utterance.rate = 0.9;
      utterance.pitch = 1.0;
      
      utterance.onend = () => {
        console.log('Speech finished (Web Speech API)');
        if (callback) callback();
      };
      
      utterance.onerror = (error) => {
        console.error('Speech error (Web Speech API):', error);
        if (callback) callback();
      };
      
      window.speechSynthesis.speak(utterance);
    } else {
      // Fallback to expo-speech for mobile
      Speech.speak(text, {
        language: 'es-ES',
        pitch: 1.0,
        rate: 0.9,
        onDone: () => {
          console.log('Speech finished (Expo)');
          if (callback) callback();
        },
        onStopped: () => {
          console.log('Speech stopped (Expo)');
          if (callback) callback();
        },
        onError: (error) => {
          console.error('Speech error (Expo):', error);
          if (callback) callback();
        }
      });
    }
  };

  const renderMessage = ({ item, index }) => {
    const isUser = item.startsWith('Usuario:');
    const messageText = item.replace('Usuario: ', '').replace('Dylan: ', '');

    return (
      <View style={[styles.messageContainer, isUser ? styles.userMessage : styles.dylanMessage]}>
        <View style={[styles.avatarContainer, isUser ? styles.userAvatar : styles.dylanAvatar]}>
          <Ionicons
            name={isUser ? 'person-circle' : 'hardware-chip'}
            size={32}
            color="#FFFFFF"
          />
        </View>
        <View style={[styles.bubble, isUser ? styles.userBubble : styles.dylanBubble]}>
          <Text style={styles.messageText}>
            {messageText}
          </Text>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.logoContainer}>
          <Ionicons name="hardware-chip" size={36} color="#00D9FF" />
        </View>
        <View>
          <Text style={styles.title}>DYLAN</Text>
          <Text style={styles.subtitle}>AI Assistant</Text>
        </View>
      </View>
      
      <View style={styles.controlPanel}>
        <TouchableOpacity
          style={[styles.button, isRecording ? styles.stopButton : styles.startButton]}
          onPress={isRecording ? stopRecording : startRecording}
        >
          <Ionicons name={isRecording ? 'stop-circle' : 'mic'} size={24} color="#FFFFFF" />
          <Text style={styles.buttonText}>
            {isRecording ? 'DETENER' : 'GRABAR'}
          </Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          style={[styles.button, voiceEnabled ? styles.voiceOnButton : styles.voiceOffButton]}
          onPress={() => {
            const newValue = !voiceEnabled;
            console.log('Toggle voice. New value:', newValue);
            setVoiceEnabled(newValue);
            voiceEnabledRef.current = newValue;
          }}
        >
          <Ionicons name={voiceEnabled ? 'volume-high' : 'volume-mute'} size={24} color="#FFFFFF" />
          <Text style={styles.buttonText}>
            {voiceEnabled ? 'VOZ ON' : 'VOZ OFF'}
          </Text>
        </TouchableOpacity>
      </View>
      
      {isProcessing && (
        <View style={styles.processingContainer}>
          <Ionicons name="sync" size={20} color="#00D9FF" />
          <Text style={styles.processingText}>Procesando...</Text>
        </View>
      )}
      <FlatList
        style={styles.conversationScroll}
        data={conversationHistory}
        renderItem={renderMessage}
        keyExtractor={(item, index) => index.toString()}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B0E1A',
    paddingTop: 50,
    paddingHorizontal: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 25,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#1A1F35',
  },
  logoContainer: {
    backgroundColor: '#0F1729',
    padding: 12,
    borderRadius: 15,
    marginRight: 15,
    borderWidth: 2,
    borderColor: '#00D9FF',
    shadowColor: '#00D9FF',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 10,
    elevation: 8,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#FFFFFF',
    letterSpacing: 3,
  },
  subtitle: {
    fontSize: 12,
    color: '#00D9FF',
    letterSpacing: 2,
    marginTop: 2,
  },
  controlPanel: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
    gap: 10,
  },
  button: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
    borderWidth: 1,
    elevation: 5,
  },
  startButton: {
    backgroundColor: '#0F2847',
    borderColor: '#1E4976',
    shadowColor: '#00D9FF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
  },
  stopButton: {
    backgroundColor: '#3D1F1F',
    borderColor: '#6B2E2E',
    shadowColor: '#FF3E3E',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
  },
  voiceOnButton: {
    backgroundColor: '#0D3B2F',
    borderColor: '#1A6B54',
    shadowColor: '#00FFB3',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
  },
  voiceOffButton: {
    backgroundColor: '#1F1F2E',
    borderColor: '#3A3A52',
    shadowColor: '#6B6B8A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 14,
    marginLeft: 8,
    fontWeight: '700',
    letterSpacing: 1,
  },
  processingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    marginBottom: 10,
    backgroundColor: '#0F1729',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#00D9FF',
  },
  processingText: {
    color: '#00D9FF',
    fontSize: 14,
    marginLeft: 8,
    fontWeight: '600',
  },
  conversationScroll: {
    flex: 1,
    padding: 10,
  },
  messageContainer: {
    flexDirection: 'row',
    marginVertical: 8,
    alignItems: 'flex-end',
  },
  userMessage: {
    justifyContent: 'flex-start',
  },
  dylanMessage: {
    justifyContent: 'flex-end',
  },
  avatarContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 8,
    borderWidth: 2,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.8,
    shadowRadius: 4,
    elevation: 5,
  },
  userAvatar: {
    backgroundColor: '#1E3A5F',
    borderColor: '#2E5A8F',
    shadowColor: '#4A90E2',
  },
  dylanAvatar: {
    backgroundColor: '#0F2535',
    borderColor: '#00D9FF',
    shadowColor: '#00D9FF',
  },
  bubble: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 18,
    maxWidth: '70%',
    borderWidth: 1,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 3,
  },
  userBubble: {
    backgroundColor: '#1A2F4F',
    borderColor: '#2A4A6F',
    borderBottomLeftRadius: 4,
  },
  dylanBubble: {
    backgroundColor: '#0F1F2E',
    borderColor: '#00D9FF',
    borderBottomRightRadius: 4,
    shadowColor: '#00D9FF',
  },
  messageText: {
    fontSize: 15,
    lineHeight: 22,
    color: '#E8E8E8',
  },
});

export default App;
