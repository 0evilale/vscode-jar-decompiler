plugins {
    id("java")
    id("com.github.johnrengelman.shadow") version "8.1.1"
}

group = "decompiler"
version = "1.0"

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

repositories {
    mavenCentral()
    maven { url = uri("https://maven.fabricmc.net") }
}

dependencies {
    implementation("net.fabricmc:cfr:0.2.2")
    implementation("org.vineflower:vineflower:1.11.1")
    implementation("org.bitbucket.mstrobel:procyon-compilertools:0.6.0")
    implementation("com.google.code.gson:gson:2.10.1")
}

tasks.shadowJar {
    archiveFileName = "decompiler-backend.jar"
    archiveClassifier = null
    manifest {
        attributes["Main-Class"] = "com.evilale.decompiler.cli.CliMain"
    }
}

tasks.jar { enabled = false }
