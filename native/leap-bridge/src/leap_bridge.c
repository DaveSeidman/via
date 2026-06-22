#include "LeapC.h"

#include <pthread.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static volatile bool is_running = true;
static LEAP_CONNECTION connection = NULL;
static pthread_mutex_t leap_lock = PTHREAD_MUTEX_INITIALIZER;

static void print_vec3(LEAP_VECTOR value) {
  printf("[%0.3f,%0.3f,%0.3f]", value.x, value.y, value.z);
}

static const char* hand_type_name(eLeapHandType type) {
  return type == eLeapHandType_Left ? "left" : "right";
}

static const char* mode_name(eLeapTrackingMode mode) {
  switch (mode) {
    case eLeapTrackingMode_HMD:
      return "hmd";
    case eLeapTrackingMode_ScreenTop:
      return "screentop";
    case eLeapTrackingMode_Desktop:
    default:
      return "desktop";
  }
}

static void set_tracking_mode(eLeapTrackingMode mode) {
  pthread_mutex_lock(&leap_lock);
  if (connection != NULL) {
    eLeapRS result = LeapSetTrackingMode(connection, mode);
    if (result != eLeapRS_Success) {
      fprintf(stderr, "LeapSetTrackingMode(%s) failed: %d\n", mode_name(mode), result);
    } else {
      fprintf(stderr, "Tracking mode set to %s\n", mode_name(mode));
    }
  }
  pthread_mutex_unlock(&leap_lock);
}

static void* stdin_loop(void* unused) {
  (void)unused;

  char line[256];
  while (is_running && fgets(line, sizeof(line), stdin) != NULL) {
    if (strstr(line, "screentop") != NULL) {
      set_tracking_mode(eLeapTrackingMode_ScreenTop);
    } else if (strstr(line, "hmd") != NULL) {
      set_tracking_mode(eLeapTrackingMode_HMD);
    } else if (strstr(line, "desktop") != NULL) {
      set_tracking_mode(eLeapTrackingMode_Desktop);
    }
  }

  return NULL;
}

static void print_device_event(bool attached) {
  printf("{\"event\":{\"type\":\"deviceEvent\",\"state\":{\"attached\":%s,\"streaming\":%s,\"type\":\"Ultraleap\"}}}\n",
    attached ? "true" : "false",
    attached ? "true" : "false");
  fflush(stdout);
}

static void print_bone(const LEAP_BONE* bone) {
  printf("{\"prevJoint\":");
  print_vec3(bone->prev_joint);
  printf(",\"nextJoint\":");
  print_vec3(bone->next_joint);
  printf(",\"width\":%0.3f}", bone->width);
}

static void print_digit(const LEAP_DIGIT* digit, int index) {
  printf("{\"id\":%d,\"type\":%d,\"extended\":%s,\"bones\":[",
    digit->finger_id,
    index,
    digit->is_extended ? "true" : "false");

  for (int bone_index = 0; bone_index < 4; bone_index++) {
    if (bone_index > 0) {
      printf(",");
    }
    print_bone(&digit->bones[bone_index]);
  }

  printf("]}");
}

static void print_hand(const LEAP_HAND* hand) {
  printf("{\"id\":%u,\"type\":\"%s\",\"confidence\":%0.3f,\"pinchStrength\":%0.3f,\"grabStrength\":%0.3f,",
    hand->id,
    hand_type_name(hand->type),
    hand->confidence,
    hand->pinch_strength,
    hand->grab_strength);

  printf("\"palmPosition\":");
  print_vec3(hand->palm.position);
  printf(",\"palmNormal\":");
  print_vec3(hand->palm.normal);
  printf(",\"direction\":");
  print_vec3(hand->palm.direction);
  printf(",\"wrist\":");
  print_vec3(hand->arm.next_joint);
  printf(",\"elbow\":");
  print_vec3(hand->arm.prev_joint);
  printf(",\"fingers\":[");

  for (int digit_index = 0; digit_index < 5; digit_index++) {
    if (digit_index > 0) {
      printf(",");
    }
    print_digit(&hand->digits[digit_index], digit_index);
  }

  printf("]}");
}

static void print_tracking_event(const LEAP_TRACKING_EVENT* frame) {
  printf("{\"id\":%lld,\"timestamp\":%lld,\"currentFrameRate\":%0.3f,\"hands\":[",
    (long long)frame->tracking_frame_id,
    (long long)frame->info.timestamp,
    frame->framerate);

  for (uint32_t hand_index = 0; hand_index < frame->nHands; hand_index++) {
    if (hand_index > 0) {
      printf(",");
    }
    print_hand(&frame->pHands[hand_index]);
  }

  printf("]}\n");
  fflush(stdout);
}

int main(int argc, const char** argv) {
  eLeapTrackingMode initial_mode = eLeapTrackingMode_Desktop;

  if (argc > 1) {
    if (strcmp(argv[1], "screentop") == 0) {
      initial_mode = eLeapTrackingMode_ScreenTop;
    } else if (strcmp(argv[1], "hmd") == 0) {
      initial_mode = eLeapTrackingMode_HMD;
    }
  }

  setvbuf(stdout, NULL, _IOLBF, 0);

  eLeapRS result = LeapCreateConnection(NULL, &connection);
  if (result != eLeapRS_Success) {
    fprintf(stderr, "LeapCreateConnection failed: %d\n", result);
    return 1;
  }

  result = LeapOpenConnection(connection);
  if (result != eLeapRS_Success) {
    fprintf(stderr, "LeapOpenConnection failed: %d\n", result);
    LeapDestroyConnection(connection);
    return 1;
  }

  pthread_t stdin_thread;
  pthread_create(&stdin_thread, NULL, stdin_loop, NULL);

  printf("{\"version\":6,\"serviceVersion\":\"Ultraleap Hyperion LeapC\"}\n");
  fflush(stdout);
  set_tracking_mode(initial_mode);

  while (is_running) {
    LEAP_CONNECTION_MESSAGE message;
    memset(&message, 0, sizeof(message));

    pthread_mutex_lock(&leap_lock);
    result = LeapPollConnection(connection, 1000, &message);
    pthread_mutex_unlock(&leap_lock);

    if (result != eLeapRS_Success) {
      fprintf(stderr, "LeapPollConnection failed: %d\n", result);
      continue;
    }

    switch (message.type) {
      case eLeapEventType_Device:
        print_device_event(true);
        break;
      case eLeapEventType_DeviceLost:
        print_device_event(false);
        break;
      case eLeapEventType_Tracking:
        print_tracking_event(message.tracking_event);
        break;
      default:
        break;
    }
  }

  LeapCloseConnection(connection);
  LeapDestroyConnection(connection);
  return 0;
}
