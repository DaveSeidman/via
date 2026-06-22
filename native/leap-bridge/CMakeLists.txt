cmake_minimum_required(VERSION 3.16)

project(leap_bridge C)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)

set(ULTRALEAP_SDK_PATH "/Applications/Ultraleap Hand Tracking.app/Contents/LeapSDK" CACHE PATH "Path to Ultraleap LeapSDK")

add_executable(leap_bridge src/leap_bridge.c)

target_include_directories(leap_bridge PRIVATE "${ULTRALEAP_SDK_PATH}/include")
target_link_libraries(leap_bridge PRIVATE "${ULTRALEAP_SDK_PATH}/lib/libLeapC.dylib")

if(APPLE)
  set_target_properties(leap_bridge PROPERTIES
    BUILD_RPATH "${ULTRALEAP_SDK_PATH}/lib"
    INSTALL_RPATH "${ULTRALEAP_SDK_PATH}/lib"
  )
endif()
