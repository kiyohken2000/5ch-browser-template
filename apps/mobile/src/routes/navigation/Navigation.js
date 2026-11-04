/**
 * ナビゲーション（§7）。
 *
 * ボイラープレートはログインの有無で分岐する作りだったが、**Ember に
 * アプリレベルのログインは無い。** 5ch の認証（Ronin / BE / どんぐり）は
 * 投稿のときだけ要るもので、読むだけなら不要なので M2 で投稿画面側に付ける。
 *
 *   BottomTabs
 *   ├─ ホーム    監視リスト
 *   ├─ 板        カテゴリツリー → スレ一覧
 *   └─ 設定      表示設定 + NG 管理
 *   スレビューは各タブのスタックに push する（主画面）
 */

import React from 'react'
import {
  NavigationContainer,
  DefaultTheme,
  DarkTheme,
} from '@react-navigation/native'
import { createStackNavigator } from '@react-navigation/stack'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import Toast from 'react-native-toast-message'

import Boards from 'scenes/boards/Boards'
import Home from 'scenes/home/Home'
import Settings from 'scenes/settings/Settings'
import Thread from 'scenes/thread/Thread'
import Threads from 'scenes/threads/Threads'
import { useEmberTheme } from 'theme/ember'

const Tab = createBottomTabNavigator()
const Stack = createStackNavigator()

function stackScreens(theme) {
  return {
    headerStyle: { backgroundColor: theme.surface },
    headerTintColor: theme.text,
    headerTitleStyle: { fontSize: 16 },
    cardStyle: { backgroundColor: theme.bg },
  }
}

function HomeStack() {
  const theme = useEmberTheme()
  return (
    <Stack.Navigator screenOptions={stackScreens(theme)}>
      <Stack.Screen
        name="Watch"
        component={Home}
        options={{ title: 'ホーム' }}
      />
      <Stack.Screen name="Thread" component={Thread} />
    </Stack.Navigator>
  )
}

function BoardStack() {
  const theme = useEmberTheme()
  return (
    <Stack.Navigator screenOptions={stackScreens(theme)}>
      <Stack.Screen
        name="Boards"
        component={Boards}
        options={{ title: '板一覧' }}
      />
      <Stack.Screen name="Threads" component={Threads} />
      <Stack.Screen name="Thread" component={Thread} />
    </Stack.Navigator>
  )
}

function SettingsStack() {
  const theme = useEmberTheme()
  return (
    <Stack.Navigator screenOptions={stackScreens(theme)}>
      <Stack.Screen
        name="SettingsTop"
        component={Settings}
        options={{ title: '設定' }}
      />
    </Stack.Navigator>
  )
}

export default function Navigation() {
  const theme = useEmberTheme()
  const navTheme = {
    ...(theme.dark ? DarkTheme : DefaultTheme),
    colors: {
      ...(theme.dark ? DarkTheme : DefaultTheme).colors,
      background: theme.bg,
      card: theme.surface,
      text: theme.text,
      border: theme.border,
      primary: theme.accent,
    },
  }

  return (
    <>
      <NavigationContainer theme={navTheme}>
        <Tab.Navigator
          screenOptions={{
            headerShown: false,
            tabBarActiveTintColor: theme.accent,
            tabBarInactiveTintColor: theme.textFaint,
            tabBarStyle: {
              backgroundColor: theme.surface,
              borderTopColor: theme.border,
            },
          }}
        >
          <Tab.Screen
            name="HomeTab"
            component={HomeStack}
            options={{ title: 'ホーム' }}
          />
          <Tab.Screen
            name="BoardTab"
            component={BoardStack}
            options={{ title: '板' }}
          />
          <Tab.Screen
            name="SettingsTab"
            component={SettingsStack}
            options={{ title: '設定' }}
          />
        </Tab.Navigator>
      </NavigationContainer>
      <Toast />
    </>
  )
}
