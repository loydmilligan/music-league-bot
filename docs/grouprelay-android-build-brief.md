# GroupRelay — Android App Build Brief

**For:** Claude Code (CC). This is a complete, self-contained spec for a **new, standalone Android app**. Do not assume or reuse any other project. Build exactly what's described here.

**One sentence:** GroupRelay is a phone-side **capture appliance**. In this first version it captures group-chat messages from WhatsApp and Google Chat via the notification stream and POSTs them to a webhook — but it is built around a small, source-agnostic core so future capture sources (other apps, the call log, etc.) can be added later as new files, with **no change** to the event format, the transport, or the backend.

---

## 1. Purpose, scope, and the modular intent

GroupRelay runs on a dedicated "watcher" phone whose job is to observe things that flow through the phone and forward them, normalized, to a backend.

**Why a watcher phone captures whole group chats:** in a group, every member's message produces a notification on every *other* member's device. A dedicated account that never sends messages therefore receives a notification for **every** human message in the group — including the operator's own — with no blind spot.

**v1 ships exactly one capture source** (the notification listener) configured for exactly two apps (WhatsApp, Google Chat). But the architecture (Section 3) separates *sources* from the *normalized event* from the *transport*, so later you could add — without refactoring — a notification extractor for, say, food-delivery apps (order/spend tracking), or an entirely different source like the call log. **Do not build those now.** Build the seam; ship one source.

### Non-goals for v1 (do NOT build these)

- No call-log, SMS, or content-provider sources. (Architecture must *allow* them; v1 must not *contain* them.)
- No plain-notification extractor. (Only MessagingStyle, for the two chat apps. The pattern for adding a plain extractor later is in the appendix.)
- No notification prioritization, scoring, AI, rules, channels, or inbox UI.
- No on-device message storage beyond small debug counters.
- No generic plugin/DI framework. The seam is a few interfaces, not a runtime plugin loader.

---

## 2. The five things that are easy to get wrong

CC: implement these correctly — they are the difference between a working relay and a lossy one.

1. **Sender can be a `Person`, not a string.** MessagingStyle bundles store the sender under the legacy `"sender"` CharSequence *or* the newer `"sender_person"` `Person` object (API 28+). Read `"sender"` first; if null, fall back to `Person.getName()`. Missing this gives null senders on modern devices.
2. **Do NOT dedup at the notification level.** Messaging apps update a chat's notification *in place* (same id/tag) as messages arrive. An early-return dedup drops messages during bursts. GroupRelay forwards **every** posted notification for a target app; the **backend** dedups by event content hash. The MessagingStyle array re-carries recent history, so forwarding everything + backend dedup recovers bursts.
3. **Use the per-message timestamp, not the notification post time.** Each message bundle has its own `"time"` (epoch ms) — the real send time.
4. **Group name lives in `EXTRA_CONVERSATION_TITLE`, falling back to `EXTRA_TITLE`.** For group MessagingStyle the conversation title is the group; per-message sender is the individual.
5. **The extractor decides what's relevant, not the listener.** The listener is a dumb pipe: it looks up an extractor for the package and, if one exists, runs it. All app-specific knowledge lives in extractors. This is what makes adding sources/apps additive.

---

## 3. Architecture — three layers

The whole point of the rewrite. Keep these concerns separate:

```
            ┌─────────────────────────────────────────────┐
 LAYER 1    │  Capture sources  (a source = anything that  │
 sources    │  produces events; v1 ships ONE)              │
            │                                              │
            │  NotificationSource  ──uses──▶ extractors:   │
            │     CaptureNotificationListenerService          │
            │        → ExtractorRegistry (package→extractor)│
            │            → MessagingStyleExtractor (v1)     │
            │                                              │
            │  [future: CallLogSource, SmsSource, ...]     │
            └───────────────────────┬─────────────────────┘
                                    │  emits CaptureEvent[]
 LAYER 2                            ▼
 normalized          ┌──────────────────────────────┐
 event               │  CaptureEvent  (one shape for │
                     │  every source / platform)     │
                     └───────────────┬──────────────┘
                                     │  EventSink.submit(events, sourceType)
 LAYER 3                             ▼
 transport           ┌──────────────────────────────┐
                     │  WebhookEventSink             │
                     │  → POST CaptureBatch (JSON)   │
                     └───────────────┬──────────────┘
                                     ▼
                          backend: explode + dedup by content hash
```

**Layer 1 — sources.** A `CaptureSource` produces events and has a lifecycle (`start`/`stop`). v1 has one: `NotificationSource`, whose events come from the Android notification listener. A future `CallLogSource` would, in its `start()`, register a `ContentObserver` and emit `CaptureEvent`s itself — implementing the same interface, going to the same sink. The notification source delegates app-specific parsing to **extractors** chosen per package, so adding an app (or a non-chat extractor) is also additive.

**Layer 2 — the normalized event.** Every source, every platform, emits the same `CaptureEvent`. The backend and any downstream (a unified inbox, a spend tracker) never care where an event came from. The event carries fields v1 won't fully populate but the future needs — `direction`, `party_handle`, `event_type`, `duration_ms` — so adding sources never requires a schema change. This is the one decision that's expensive to retrofit, so we make it now.

**Layer 3 — transport.** One `EventSink` interface, one `WebhookEventSink` implementation, one JSON envelope (`CaptureBatch`). Every source's output converges here. The dedup hash includes `source_type` so the same real-world event seen by two sources can be reconciled rather than double-counted.

---

## 4. Project structure

```
grouprelay/
├── settings.gradle
├── build.gradle
├── gradle.properties
├── app/
│   ├── build.gradle
│   ├── proguard-rules.pro
│   └── src/main/
│       ├── AndroidManifest.xml
│       ├── java/com/grouprelay/
│       │   ├── MainActivity.java
│       │   ├── core/
│       │   │   ├── CaptureCore.java          # wires prefs + sink + registries
│       │   │   ├── CaptureEvent.java         # LAYER 2 — normalized event
│       │   │   ├── CaptureBatch.java         # transport envelope
│       │   │   ├── EventSink.java            # LAYER 3 — interface
│       │   │   ├── WebhookEventSink.java     # LAYER 3 — impl
│       │   │   ├── CaptureSource.java        # LAYER 1 — interface
│       │   │   └── SourceRegistry.java       # lifecycle of all sources
│       │   ├── source/notification/
│       │   │   ├── CaptureNotificationListenerService.java  # system entry point
│       │   │   ├── NotificationSource.java   # CaptureSource for notifications
│       │   │   ├── NotificationExtractor.java# extractor interface
│       │   │   ├── MessagingStyleExtractor.java  # v1 extractor (chat apps)
│       │   │   └── ExtractorRegistry.java    # package → (extractor, platform)
│       │   ├── service/
│       │   │   └── RelayForegroundService.java
│       │   └── util/
│       │       ├── Prefs.java
│       │       ├── Stats.java
│       │       └── BootReceiver.java
│       └── res/ (layout/activity_main.xml, values/strings.xml, colors.xml, themes.xml)
```

---

## 5. Gradle & build config

**`settings.gradle`**
```groovy
pluginManagement { repositories { google(); mavenCentral(); gradlePluginPortal() } }
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories { google(); mavenCentral() }
}
rootProject.name = "GroupRelay"
include ':app'
```

**`build.gradle` (top level)**
```groovy
plugins { id 'com.android.application' version '8.7.3' apply false }
```

**`gradle.properties`**
```properties
org.gradle.jvmargs=-Xmx2048m -Dfile.encoding=UTF-8
android.useAndroidX=true
android.nonTransitiveRClass=true
```

**`app/build.gradle`**
```groovy
plugins { id 'com.android.application' }
android {
    namespace 'com.grouprelay'
    compileSdk 35
    defaultConfig {
        applicationId "com.grouprelay"
        minSdk 26
        targetSdk 35
        versionCode 1
        versionName "1.0.0"
    }
    buildTypes {
        release {
            minifyEnabled false
            proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
        }
    }
    compileOptions {
        sourceCompatibility JavaVersion.VERSION_17
        targetCompatibility JavaVersion.VERSION_17
    }
}
dependencies {
    implementation 'androidx.appcompat:appcompat:1.7.0'
    implementation 'com.google.android.material:material:1.12.0'
    implementation 'com.squareup.okhttp3:okhttp:4.12.0'
    implementation 'com.google.code.gson:gson:2.10.1'
}
```

**`proguard-rules.pro`**
```proguard
-keepattributes Signature, *Annotation*
-keep class com.grouprelay.core.** { *; }
-dontwarn okhttp3.**
-dontwarn okio.**
```

---

## 6. AndroidManifest.xml (complete)

> Note: v1 declares **only** the permissions the notification source needs. Do **not** add `READ_CALL_LOG` / `READ_SMS` etc. now — those draw Play Store policy scrutiny and scary prompts; they get added the day their source is built.

```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:tools="http://schemas.android.com/tools">

    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_SPECIAL_USE" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
    <uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
    <uses-permission android:name="android.permission.WAKE_LOCK" />

    <application
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher"
        android:label="@string/app_name"
        android:supportsRtl="true"
        android:theme="@style/Theme.GroupRelay"
        tools:targetApi="34">

        <activity android:name=".MainActivity" android:exported="true"
            android:label="@string/app_name">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>

        <service
            android:name=".source.notification.CaptureNotificationListenerService"
            android:exported="true"
            android:label="@string/listener_label"
            android:permission="android.permission.BIND_NOTIFICATION_LISTENER_SERVICE">
            <intent-filter>
                <action android:name="android.service.notification.NotificationListenerService" />
            </intent-filter>
        </service>

        <service
            android:name=".service.RelayForegroundService"
            android:exported="false"
            android:foregroundServiceType="specialUse">
            <property android:name="android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE"
                android:value="chat_notification_relay" />
        </service>

        <receiver android:name=".util.BootReceiver" android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.BOOT_COMPLETED" />
            </intent-filter>
        </receiver>
    </application>
</manifest>
```

---

## 7. Layer 2 — the normalized event (complete)

This is the load-bearing contract. Get it right and everything else is swappable.

**`core/CaptureEvent.java`**
```java
package com.grouprelay.core;

import com.google.gson.annotations.SerializedName;

/**
 * One normalized event from any source/platform. v1 (notification source)
 * fills: platform, package_name, event_type="message", direction="incoming",
 * conversation, conversation_key, party, text, timestamp.
 * Other fields exist now so future sources never force a schema change.
 */
public class CaptureEvent {
    @SerializedName("platform")         public String platform;       // "whatsapp" | "googlechat" | ...
    @SerializedName("package_name")     public String packageName;
    @SerializedName("event_type")       public String eventType;      // "message" (v1) | "call" | "order" | ...
    @SerializedName("direction")        public String direction;      // "incoming" | "outgoing" | "unknown"
    @SerializedName("conversation")     public String conversation;   // group/thread/contact name
    @SerializedName("conversation_key") public String conversationKey;// stable-ish id (nullable)
    @SerializedName("party")            public String party;          // sender / caller display name (nullable)
    @SerializedName("party_handle")     public String partyHandle;    // phone/email/id (nullable; future sources)
    @SerializedName("text")             public String text;           // body (nullable; calls have none)
    @SerializedName("timestamp")        public long   timestamp;      // epoch ms, the real event time
    @SerializedName("duration_ms")      public Long   durationMs;     // calls only (nullable)
}
```

**`core/CaptureBatch.java`** — one batch per source emission (e.g. one notification's messages).
```java
package com.grouprelay.core;

import com.google.gson.annotations.SerializedName;
import java.util.List;

public class CaptureBatch {
    @SerializedName("source_type") public String sourceType;   // "notification" (v1) | "calllog" | ...
    @SerializedName("device_id")   public String deviceId;
    @SerializedName("sent_at")     public long   sentAt;       // epoch ms when forwarded
    @SerializedName("events")      public List<CaptureEvent> events;
}
```

---

## 8. Layer 3 — transport (complete)

**`core/EventSink.java`**
```java
package com.grouprelay.core;

import java.util.List;

/** Where every source sends its normalized events. One implementation in v1. */
public interface EventSink {
    void submit(List<CaptureEvent> events, String sourceType);
    void test(TestCallback cb);
    interface TestCallback { void onResult(boolean ok, String message); }
}
```

**`core/WebhookEventSink.java`**
```java
package com.grouprelay.core;

import android.util.Log;
import com.google.gson.Gson;
import com.grouprelay.util.Prefs;
import com.grouprelay.util.Stats;

import java.io.IOException;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import okhttp3.*;

public class WebhookEventSink implements EventSink {
    private static final String TAG = "GroupRelaySink";
    private static final MediaType JSON = MediaType.parse("application/json; charset=utf-8");
    private static final int MAX_RETRIES = 3;
    private static final long RETRY_BASE_MS = 1000;

    private final Prefs prefs;
    private final Gson gson = new Gson();
    private final ExecutorService exec = Executors.newSingleThreadExecutor();
    private final OkHttpClient client = new OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS).build();

    public WebhookEventSink(Prefs prefs) { this.prefs = prefs; }

    @Override
    public void submit(List<CaptureEvent> events, String sourceType) {
        if (events == null || events.isEmpty()) return;
        final String url = prefs.getWebhookUrl();
        if (url == null || url.isEmpty()) return;

        CaptureBatch batch = new CaptureBatch();
        batch.sourceType = sourceType;
        batch.deviceId = prefs.getDeviceId();
        batch.sentAt = System.currentTimeMillis();
        batch.events = events;

        final String body = gson.toJson(batch);
        final String token = prefs.getAuthToken();
        final int n = events.size();

        exec.execute(() -> {
            for (int attempt = 1; attempt <= MAX_RETRIES; attempt++) {
                try {
                    Request.Builder rb = new Request.Builder().url(url)
                            .post(RequestBody.create(body, JSON))
                            .header("Content-Type", "application/json")
                            .header("X-GroupRelay-Device", prefs.getDeviceId());
                    if (token != null && !token.isEmpty()) rb.header("Authorization", "Bearer " + token);
                    try (Response resp = client.newCall(rb.build()).execute()) {
                        if (resp.isSuccessful()) { Stats.get().addForwarded(n); return; }
                        Log.w(TAG, "HTTP " + resp.code() + " attempt " + attempt);
                    }
                } catch (IOException e) {
                    Log.e(TAG, "Net error attempt " + attempt + ": " + e.getMessage());
                }
                if (attempt < MAX_RETRIES) {
                    try { Thread.sleep(RETRY_BASE_MS * attempt); }
                    catch (InterruptedException ie) { Thread.currentThread().interrupt(); break; }
                }
            }
            Stats.get().addFailed(n);
        });
    }

    @Override
    public void test(TestCallback cb) {
        final String url = prefs.getWebhookUrl();
        final String token = prefs.getAuthToken();
        exec.execute(() -> {
            if (url == null || url.isEmpty()) { cb.onResult(false, "No webhook URL"); return; }
            String test = "{\"source_type\":\"test\",\"events\":[]}";
            try {
                Request.Builder rb = new Request.Builder().url(url)
                        .post(RequestBody.create(test, JSON)).header("X-GroupRelay-Test", "true");
                if (token != null && !token.isEmpty()) rb.header("Authorization", "Bearer " + token);
                try (Response resp = client.newCall(rb.build()).execute()) {
                    cb.onResult(resp.isSuccessful(),
                            resp.isSuccessful() ? "Connected" : "Server returned " + resp.code());
                }
            } catch (IOException e) { cb.onResult(false, "Failed: " + e.getMessage()); }
        });
    }
}
```

---

## 9. Layer 1 — sources

**`core/CaptureSource.java`** — the seam future sources implement.
```java
package com.grouprelay.core;

import android.content.Context;

/** Anything that produces CaptureEvents. v1 has one impl: NotificationSource. */
public interface CaptureSource {
    String id();                       // e.g. "notification"
    String displayName();
    void start(Context ctx, EventSink sink);  // begin producing (register observers, mark active, ...)
    void stop();                              // stop producing
    boolean isActive();
}
```

**`core/SourceRegistry.java`** — uniform lifecycle over all sources.
```java
package com.grouprelay.core;

import android.content.Context;
import java.util.List;

public class SourceRegistry {
    private final List<CaptureSource> sources;
    public SourceRegistry(List<CaptureSource> sources) { this.sources = sources; }
    public void startAll(Context ctx, EventSink sink) { for (CaptureSource s : sources) s.start(ctx, sink); }
    public void stopAll() { for (CaptureSource s : sources) s.stop(); }
    public List<CaptureSource> all() { return sources; }
}
```

**`core/CaptureCore.java`** — single place that wires everything; sources and the listener read it.
```java
package com.grouprelay.core;

import android.content.Context;
import com.grouprelay.source.notification.ExtractorRegistry;
import com.grouprelay.source.notification.NotificationSource;
import com.grouprelay.util.Prefs;

import java.util.Collections;

public class CaptureCore {
    private static CaptureCore INSTANCE;

    private final Prefs prefs;
    private final EventSink sink;
    private final ExtractorRegistry extractors;
    private final NotificationSource notificationSource;
    private final SourceRegistry sources;

    private CaptureCore(Context app) {
        this.prefs = new Prefs(app);
        this.sink = new WebhookEventSink(prefs);
        this.extractors = new ExtractorRegistry(prefs);
        this.notificationSource = new NotificationSource();
        // v1: exactly one source. Add more here later — nothing else changes.
        this.sources = new SourceRegistry(Collections.singletonList(notificationSource));
    }

    public static synchronized CaptureCore get(Context ctx) {
        if (INSTANCE == null) INSTANCE = new CaptureCore(ctx.getApplicationContext());
        return INSTANCE;
    }

    public Prefs prefs() { return prefs; }
    public EventSink sink() { return sink; }
    public ExtractorRegistry extractors() { return extractors; }
    public NotificationSource notificationSource() { return notificationSource; }
    public SourceRegistry sources() { return sources; }
}
```

**`source/notification/NotificationSource.java`** — the v1 source. Lightweight: the actual callbacks arrive in the system listener service (below), so this mostly tracks active state and lets the registry start/stop it uniformly with future sources.
```java
package com.grouprelay.source.notification;

import android.content.Context;
import com.grouprelay.core.CaptureSource;
import com.grouprelay.core.EventSink;

public class NotificationSource implements CaptureSource {
    private volatile boolean active = false;
    @Override public String id() { return "notification"; }
    @Override public String displayName() { return "App notifications"; }
    @Override public void start(Context ctx, EventSink sink) { active = true; }
    @Override public void stop() { active = false; }
    @Override public boolean isActive() { return active; }
}
```

**`source/notification/NotificationExtractor.java`** — per-app parsing strategy.
```java
package com.grouprelay.source.notification;

import android.service.notification.StatusBarNotification;
import com.grouprelay.core.CaptureEvent;
import com.grouprelay.util.Prefs;
import java.util.List;

/** Turns one notification into zero or more normalized events. One impl in v1. */
public interface NotificationExtractor {
    List<CaptureEvent> extract(StatusBarNotification sbn, Prefs prefs);
}
```

**`source/notification/ExtractorRegistry.java`** — maps a package to its extractor + platform. **This is where you add apps later** (and, later still, a different extractor type).
```java
package com.grouprelay.source.notification;

import com.grouprelay.util.Prefs;
import java.util.HashMap;
import java.util.Map;

public class ExtractorRegistry {
    private final Map<String, NotificationExtractor> byPackage = new HashMap<>();

    public ExtractorRegistry(Prefs prefs) {
        // v1: two chat apps, both MessagingStyle. Adding an app later = one line here
        // (and, for non-chat apps, a new extractor class — see appendix).
        register("com.whatsapp", new MessagingStyleExtractor("whatsapp"));
        register("com.google.android.apps.dynamite", new MessagingStyleExtractor("googlechat"));
    }

    private void register(String pkg, NotificationExtractor ex) { byPackage.put(pkg, ex); }

    /** @return the extractor for this package, or null if the package isn't a target. */
    public NotificationExtractor forPackage(String pkg) { return byPackage.get(pkg); }
}
```

**`source/notification/MessagingStyleExtractor.java`** — the v1 extractor (the only app-specific logic).
```java
package com.grouprelay.source.notification;

import android.app.Notification;
import android.app.Person;
import android.os.Build;
import android.os.Bundle;
import android.os.Parcelable;
import android.service.notification.StatusBarNotification;

import com.grouprelay.core.CaptureEvent;
import com.grouprelay.util.Prefs;

import java.util.ArrayList;
import java.util.List;

public class MessagingStyleExtractor implements NotificationExtractor {
    private final String platform;
    public MessagingStyleExtractor(String platform) { this.platform = platform; }

    @Override
    public List<CaptureEvent> extract(StatusBarNotification sbn, Prefs prefs) {
        List<CaptureEvent> out = new ArrayList<>();
        Notification n = sbn.getNotification();
        if (n == null || n.extras == null) return out;
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return out;

        Bundle extras = n.extras;
        String group = groupName(extras, sbn);
        String groupKey = sbn.getGroupKey();

        addAll(out, extras.getParcelableArray(Notification.EXTRA_MESSAGES), group, groupKey, sbn.getPackageName());
        addAll(out, extras.getParcelableArray(Notification.EXTRA_HISTORIC_MESSAGES), group, groupKey, sbn.getPackageName());
        return out;
    }

    private void addAll(List<CaptureEvent> out, Parcelable[] arr,
                        String group, String groupKey, String pkg) {
        if (arr == null) return;
        for (Parcelable p : arr) {
            if (!(p instanceof Bundle)) continue;
            Bundle b = (Bundle) p;
            CharSequence text = b.getCharSequence("text");
            if (text == null) continue;

            CharSequence sender = b.getCharSequence("sender");
            if (sender == null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                Object person = b.getParcelable("sender_person");
                if (person instanceof Person) sender = ((Person) person).getName();
            }

            CaptureEvent e = new CaptureEvent();
            e.platform = platform;
            e.packageName = pkg;
            e.eventType = "message";
            e.direction = "incoming";          // watcher receives everything in the group
            e.conversation = group;
            e.conversationKey = groupKey;
            e.party = sender != null ? sender.toString() : null;
            e.partyHandle = null;              // notifications rarely expose a handle
            e.text = text.toString();
            e.timestamp = b.getLong("time", 0L);
            e.durationMs = null;
            out.add(e);
        }
    }

    private String groupName(Bundle extras, StatusBarNotification sbn) {
        CharSequence t = extras.getCharSequence(Notification.EXTRA_CONVERSATION_TITLE);
        if (t == null) t = extras.getCharSequence(Notification.EXTRA_TITLE);
        return t != null ? t.toString() : sbn.getPackageName();
    }
}
```

**`source/notification/CaptureNotificationListenerService.java`** — the system entry point; a dumb pipe to the registry + sink.
```java
package com.grouprelay.source.notification;

import android.os.Build;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import android.util.Log;

import com.grouprelay.core.CaptureCore;
import com.grouprelay.core.CaptureEvent;
import com.grouprelay.util.Stats;

import java.util.List;

public class CaptureNotificationListenerService extends NotificationListenerService {
    private static final String TAG = "GroupRelayListener";

    @Override public void onListenerConnected() { Log.i(TAG, "Listener connected"); }

    @Override public void onListenerDisconnected() {
        Log.w(TAG, "Listener disconnected");
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            requestRebind(new android.content.ComponentName(
                    this, CaptureNotificationListenerService.class));
        }
    }

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        CaptureCore core = CaptureCore.get(this);
        if (!core.prefs().isEnabled()) return;
        if (!core.notificationSource().isActive()) return;

        NotificationExtractor ex = core.extractors().forPackage(sbn.getPackageName());
        if (ex == null) return;   // not a target app

        List<CaptureEvent> events = ex.extract(sbn, core.prefs());
        if (events.isEmpty()) return;   // media-only / collapsed / no text

        Stats.get().addCaptured(events.size());
        core.sink().submit(events, core.notificationSource().id());   // sourceType="notification"
    }
}
```

---

## 10. Supporting classes (spec)

**`util/Stats.java`** — singleton with `AtomicLong captured/forwarded/failed` and `addCaptured/addForwarded/addFailed`. Shown in the UI and the FG notification.

**`util/Prefs.java`** — SharedPreferences wrapper:
- `getWebhookUrl()/setWebhookUrl()` (default `""`), `getAuthToken()/setAuthToken()` (default `""`),
- `isEnabled()/setEnabled()` (default `true`),
- `getDeviceId()` — generated once from `Settings.Secure.ANDROID_ID` (prefix `android_`) else random UUID; persisted.
- (Target apps are defined in `ExtractorRegistry` for v1, so no package prefs are required. If you want the UI toggles to enable/disable WhatsApp vs Google Chat, store two booleans and have `ExtractorRegistry` consult `Prefs` when deciding whether to register each — optional polish, not required.)

**`util/BootReceiver.java`** — on `BOOT_COMPLETED`, if `Prefs.isEnabled()`, `startForegroundService(RelayForegroundService)`.

**`service/RelayForegroundService.java`** — `START_STICKY` foreground service. On start: create a low-importance channel, `startForeground` with a status notification reading `Stats` ("Captured X · Forwarded Y · Failed Z"), and call `CaptureCore.get(this).sources().startAll(this, core.sink())` so all sources go active. On destroy: `sources().stopAll()`. Refresh the notification every ~5s via a `Handler`. It does not capture; it keeps the process at foreground priority (so the listener survives doze) and drives source lifecycle.

> Honest note for CC: the FG service doesn't *directly* keep the notification listener alive — it keeps the **process** at higher priority, which (with battery optimization disabled, Section 13) is what makes capture survive overnight.

---

## 11. MainActivity + layout (spec)

Single scrolling config screen:
- **Status block**: notification-access granted? (check `Settings.Secure` `enabled_notification_listeners`; if not, a button opening `Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS`); FG service running?; live `Stats` (2s `Handler` refresh).
- **Enable Relay** (Switch) → `Prefs.setEnabled`; on enable request `POST_NOTIFICATIONS` (API 33+) then start the FG service; on disable stop it.
- **Webhook URL** (EditText, `textUri`) and **Auth token** (EditText, optional).
- **Test Connection** (Button) → `CaptureCore.get(this).sink().test(...)`, toast the result.
- **Setup reminder** (static text): "On the watcher account: keep notification previews ON, do NOT mute the captured groups, and disable battery optimization for this app."

`strings.xml`: `app_name`="GroupRelay", `listener_label`="GroupRelay Capture". Basic Material dark theme; no design work needed.

---

## 12. Webhook payload contract

The app POSTs `application/json`, one `CaptureBatch` per source emission (for the notification source, one batch per notification):

```json
{
  "source_type": "notification",
  "device_id": "android_ab12cd34",
  "sent_at": 1750000001000,
  "events": [
    {
      "platform": "whatsapp",
      "package_name": "com.whatsapp",
      "event_type": "message",
      "direction": "incoming",
      "conversation": "Hip jammers",
      "conversation_key": "0|com.whatsapp|...",
      "party": "Alex",
      "party_handle": null,
      "text": "anyone else think round 7 was robbery",
      "timestamp": 1749999990000,
      "duration_ms": null
    }
  ]
}
```

Headers: `Content-Type: application/json`, `X-GroupRelay-Device: <id>`, and `Authorization: Bearer <token>` when configured. Test pings send `{"source_type":"test","events":[]}` with `X-GroupRelay-Test: true`.

**Server contract:** respond `2xx`. The server explodes `events[]` into rows and **dedups by content hash** — include `source_type` so multi-source reconciliation is possible:
`sha256(source_type|platform|conversation|party|timestamp|text)`. The app never dedups.

---

## 13. Test receiver (end-to-end verification)

```python
# receiver.py  —  pip install fastapi uvicorn ; uvicorn receiver:app --host 0.0.0.0 --port 8000
from fastapi import FastAPI, Request
import hashlib

app = FastAPI()
seen = set()

def h(st, p, c, party, t, txt):
    return hashlib.sha256(f"{st}|{p}|{c}|{party}|{t}|{txt}".encode()).hexdigest()

@app.post("/api/webhooks/relay")
async def relay(req: Request):
    b = await req.json()
    st = b.get("source_type")
    if st == "test":
        print("TEST PING OK"); return {"ok": True}
    new = 0
    for e in b.get("events", []):
        key = h(st, e.get("platform"), e.get("conversation"),
                e.get("party"), e.get("timestamp"), e.get("text"))
        if key in seen:        # backend-side dedup proof
            continue
        seen.add(key); new += 1
        print(f"[{e.get('platform')}/{e.get('conversation')}] "
              f"{e.get('party')}: {e.get('text')}")
    return {"ok": True, "new": new, "total_unique": len(seen)}
```

When wired to your real server, point the app at that server's `/webhooks/relay` (which consumes the same `CaptureBatch`).

---

## 14. Build, install, configure, verify

1. `./gradlew assembleDebug`; install on the watcher phone.
2. Open GroupRelay → set **Webhook URL** (+ token) → **Test Connection** (expect toast + `TEST PING OK`).
3. **Grant Notification Access** (button opens system settings; enable GroupRelay).
4. **Enable Relay**; confirm status shows listener active + service running.
5. Watcher account: WhatsApp → Notifications → **Show preview ON**; **do not mute** captured groups.
6. Settings → Apps → GroupRelay → Battery → **Unrestricted** (same for WhatsApp / Google Chat).
7. Send test messages in a captured group from another account; confirm lines print on the receiver and **Captured/Forwarded** climb.

---

## 15. Acceptance criteria (verify all)

- [ ] Builds with `./gradlew assembleDebug`; installs on API 26–35.
- [ ] After granting access + enabling, the listener is active and survives a reboot.
- [ ] A WhatsApp group message yields a `CaptureBatch` whose event has correct `platform`, `conversation` (group name, not "com.whatsapp"), `party` (non-null on API 28+ — Person fallback), per-message `timestamp`, `direction="incoming"`, `event_type="message"`.
- [ ] Two messages in the same chat within 1–2s both reach the receiver (no notification-level dedup).
- [ ] Non-target apps produce **no** POSTs (extractor registry returns null).
- [ ] Google Chat (`com.google.android.apps.dynamite`) is captured with `platform="googlechat"`.
- [ ] Optional Bearer token sent when configured; test ping works.
- [ ] FG service shows live counts.
- [ ] **Seam check:** confirm the codebase has no app-specific logic outside `MessagingStyleExtractor` / `ExtractorRegistry`, and no source-specific logic outside `source/notification/` — i.e. the listener, sink, and event model are source-agnostic.

---

## 16. Suggested build order

1. Gradle + manifest + empty `MainActivity` that launches.
2. `core/`: `CaptureEvent`, `CaptureBatch`, `EventSink`, `WebhookEventSink`, `CaptureSource`, `SourceRegistry`, `CaptureCore`; `util/Prefs`, `util/Stats`.
3. `source/notification/`: extractor interface + `MessagingStyleExtractor` + `ExtractorRegistry` + `NotificationSource` + the listener service. Verify against the test receiver before any UI.
4. `RelayForegroundService` + `BootReceiver`.
5. `MainActivity` config UI + grant-access flow.
6. Run the acceptance checklist on a real watcher phone.

---

## Appendix — extending later (NOT in v1)

Patterns to follow when you generalize. Do not build these now; they exist so you can see the seam holds.

**Add another notification app (e.g. food delivery for spend/calorie tracking).** Most non-chat apps don't use MessagingStyle — they put content in `EXTRA_TITLE` / `EXTRA_TEXT` / `EXTRA_BIG_TEXT`. Write a second extractor and register it:

```java
// PlainTextExtractor.java — emits one event from title/text/bigText
public class PlainTextExtractor implements NotificationExtractor {
    private final String platform;
    private final String eventType;   // e.g. "order"
    public PlainTextExtractor(String platform, String eventType) {
        this.platform = platform; this.eventType = eventType;
    }
    @Override public List<CaptureEvent> extract(StatusBarNotification sbn, Prefs prefs) {
        Bundle x = sbn.getNotification().extras;
        CharSequence title = x.getCharSequence(Notification.EXTRA_TITLE);
        CharSequence text  = x.getCharSequence(Notification.EXTRA_BIG_TEXT);
        if (text == null) text = x.getCharSequence(Notification.EXTRA_TEXT);
        if (text == null) return java.util.Collections.emptyList();
        CaptureEvent e = new CaptureEvent();
        e.platform = platform; e.packageName = sbn.getPackageName();
        e.eventType = eventType; e.direction = "incoming";
        e.conversation = title != null ? title.toString() : platform;
        e.party = title != null ? title.toString() : null;
        e.text = text.toString(); e.timestamp = sbn.getPostTime();
        return java.util.Collections.singletonList(e);
    }
}
// In ExtractorRegistry: register("com.ubercab.eats", new PlainTextExtractor("ubereats", "order"));
```
Nothing else changes — same sink, same backend, same `chat_messages`/events table, deduped by hash. The backend just sees a new `platform`/`event_type` to bucket on.

**Add a non-notification source (e.g. call log).** Write `CallLogSource implements CaptureSource`; in `start()` register a `ContentObserver` on `CallLog.Calls.CONTENT_URI`, read new rows, build `CaptureEvent`s with `event_type="call"`, real `direction` (in/out — the call log has it), `party_handle` = number, `duration_ms` set, and call `sink.submit(events, "calllog")`. Add it to the `SourceRegistry` list in `CaptureCore`. This is the payoff of the `direction` / `party_handle` / `duration_ms` fields existing in `CaptureEvent` from day one — a real per-contact timeline (both directions, with call durations) needs them, and no schema change is required to add them.

**Guardrails when you do generalize.** Add each source's permissions only when that source ships. Keep extractors small and one-per-concern. Resist a runtime plugin framework — a registry of a handful of classes you control is enough. The value was never "capture everything"; it's that adding the *next* thing is a new file, not a rewrite.
