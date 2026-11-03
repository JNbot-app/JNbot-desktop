# JNbot context

JNbot stores user data and records who published plugins and profile scripts without making newer provenance metadata a requirement for older packages.

## Language

### Storage modes

**Local mode**:
The default mode in which an installation reads and writes its own JNbot data on disk.
_Avoid_: Offline mode

**Dropbox mode**:
An optional mode in which a desktop, CLI, or mobile local runtime uses the user's Dropbox account for portable JNbot data. Selecting it for the first time does not copy data from local mode.
_Avoid_: JNbot Cloud backup, automatic sync

**Portable JNbot data**:
Profile data, shared settings, plugins, stats, and recordings that belong to the selected storage mode. Local and Dropbox modes use the same portable file formats.
_Avoid_: All application files

**Device-only data**:
Minecraft client and launcher data, Minecraft server data, and Microsoft authentication details that remain on the installation regardless of storage mode. Launcher options must move out of the current `shared.json`, which also contains portable account and device records.
_Avoid_: Portable JNbot data

**JNbot Cloud backup**:
The existing manual encrypted backup service, separate from the proposed Dropbox storage mode.
_Avoid_: Dropbox mode

**Remote runtime**:
A mobile connection to another JNbot installation. Its data belongs to the host's selected storage mode.
_Avoid_: Mobile local runtime

### Package provenance

**Publisher identity**:
An installation-local Ed25519 key pair and publisher name used to sign exported plugin and profile-script content.
_Avoid_: User identity, account identity

**Signing authority**:
Possession of the private key for a publisher identity. Normal instance and cloud backups do not transfer this authority to another installation.
_Avoid_: Publisher trust, publisher name

**Publisher name**:
The display label stored with a publisher identity and copied into its signatures. The fingerprint, not this editable label, identifies the publisher key.
_Avoid_: Fingerprint, verified username

**Publisher fingerprint**:
The SHA-256 digest of a publisher's public key, displayed as the stable identifier for that key.
_Avoid_: Checksum, publisher name

**Package signature**:
An Ed25519 signature over the canonical plugin package content and its publisher metadata.
_Avoid_: Checksum, fingerprint

**Original publisher signature**:
A valid package signature retained from the plugin's recorded provenance. Exports preserve it while the signed content still matches.
_Avoid_: Exporter signature, marketplace label

**Publisher continuity**:
The relationship between an accepted URL script and an update signed by the same publisher fingerprint. A different fingerprint represents a publisher change that needs separate acceptance.
_Avoid_: Matching publisher name, matching plugin ID

**Content checksum**:
A digest used to detect whether resolved profile-script code differs from the recorded code.
_Avoid_: Signature, fingerprint

**Trusted publisher**:
A publisher key trusted because it is built into JNbot, belongs to the local installation, or was accepted by the user.
_Avoid_: Signed publisher

**Unsigned package**:
A legacy plugin or profile script with no package signature. Unsigned packages remain usable while provenance support is introduced.
_Avoid_: Invalid package, modified package

**Modified package**:
A package whose recorded checksum or signature no longer matches its content. JNbot warns when it enters the library but does not block it during later execution.
_Avoid_: Unsigned package, unsupported package

**Accepted package revision**:
The exact content digest of an unsigned or modified package that the user chose to accept. Acceptance survives removal of publisher trust but does not extend to later content or create publisher trust.
_Avoid_: Trusted publisher, accepted publisher

**Untracked legacy plugin**:
An installed plugin created before JNbot recorded package provenance. It remains runnable and unbadged because JNbot cannot infer whether it was created locally or imported.
_Avoid_: Unsigned package, modified package

**Integrity status**:
The checksum and signature results calculated for resolved profile-script content. Runtime failures in this status do not block legacy plugins or profile scripts from running.
_Avoid_: Trust decision

**Complete export**:
A profile export or backup containing every readable plugin and profile script in its declared scope. JNbot does not report success after silently omitting unreadable content.
_Avoid_: Best-effort export, partial backup

**Authenticated backup**:
A JNbot backup whose encrypted envelope was opened with its share key. Restore treats possession of that key as authorization for the contained package revisions.
_Avoid_: Trusted publisher, signing authority

# Minecraft proxy

These terms describe the required proxy architecture, not a claim that the implementation meets it. See [ADR 0005](docs/adr/0005-proxy-session-ownership-and-client-state.md) and [ADR 0007](docs/adr/0007-semantic-proxy-transfer-and-control-barriers.md).

## Language

**Proxy session**:
A `ProxySession` owns one upstream Minecraft server connection and routes packets between that connection and its attached participants. It ends when no participants remain connected.
_Avoid_: Player, client connection

**Participant**:
A connected JNbot bot, JNbot Minecraft client, or vanilla Minecraft client attached to a proxy session.
_Avoid_: Upstream account

**Active participant**:
The participant allowed to send gameplay packets through the proxy to the upstream server. Only one participant can hold this role at a time.
_Avoid_: State provider

**Frozen participant**:
A participant whose gameplay traffic cannot reach upstream. During switching, the frozen source continues sending required protocol maintenance replies; freezing must keep it connected.
_Avoid_: Disconnected participant, suspended packet reception

**State provider**:
A JNbot bot or JNbot Minecraft client that supplies current state for a switch, including while frozen and a vanilla participant is active. It must establish that its state is current; vanilla clients cannot provide state through the JNbot integration.
_Avoid_: Proxy world cache

**Participant switch**:
A transfer of control within an existing proxy session, using state supplied by a JNbot participant to initialize the recipient. The recipient may be a vanilla client, JNbot client, or bot.
_Avoid_: Upstream reconnect, account change

**Initialization stream**:
An ordered sequence of configuration and play packets that the state compiler produces incrementally from a semantic snapshot using the negotiated schema. It exists only to initialize the switch target.
_Avoid_: Recording, replay, proxy world cache

**Semantic snapshot**:
A provider-owned view of current world, entities, player, inventory, interface, and synchronization state at a defined packet boundary. The provider supplies records incrementally without exporting packet history.
_Avoid_: Replay packets, proxy world mirror

**Capture lease**:
A short-lived provider contract that exposes a consistent semantic snapshot until the transfer releases it. A provider may briefly pause local simulation and state-changing automation while protocol maintenance continues.

**Initializing participant**:
A switch target receiving initialization or subsequent live updates whose outgoing traffic cannot reach upstream. It becomes active only after its final catch-up barrier completes.

**Local switch barrier**:
A proxy-generated request and participant reply used to establish progress at the source, after target initialization, or after target catch-up. Every such exchange terminates at the proxy.

**Control generation**:
A session counter advanced on successful activation of a new participant. Writes from an earlier generation cannot exercise current control.

**Upstream account**:
The Minecraft account used for the session's connection to the real server. Its identity can differ from the username of a participant joining the proxy.
_Avoid_: Participant identity
