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
 *   ├─ 検索      スレ横断検索
 *   └─ 設定      表示設定 + NG 管理
 *   スレビューはタブの外のルートスタックに push する（§7）。**同時に開くスレは
 *   1 つだけ**で、タブバーは隠れて本文が広くなる。スレ間の移動はホームと左右スワイプ
 *
 * `ember://` で外部からスレと板を開ける（§8-1）。URL は開く先の画面で
 * `parseBoardLocation` を通るので、対応ホスト以外は取得前に止まる。
 *   ember://thread?threadUrl=<スレ URL>
 *   ember://board?boardUrl=<板 URL>&boardName=<板名>
 *   ember://search / ember://settings
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

import Icon from 'components/Icon'
import Boards from 'scenes/boards/Boards'
import Home from 'scenes/home/Home'
import Search from 'scenes/search/Search'
import Settings from 'scenes/settings/Settings'
import Thread from 'scenes/thread/Thread'
import Threads from 'scenes/threads/Threads'
import { useEmberTheme } from 'theme/ember'

const Tab = createBottomTabNavigator()
const Stack = createStackNavigator()
const RootStack = createStackNavigator()

const linking = {
  prefixes: ['ember://'],
  config: {
    screens: {
      Tabs: {
        screens: {
          HomeTab: { screens: { Watch: 'home' } },
          BoardTab: {
            initialRouteName: 'Boards',
            screens: { Boards: 'boards', Threads: 'board' },
          },
          SearchTab: { screens: { SearchTop: 'search' } },
          SettingsTab: { screens: { SettingsTop: 'settings' } },
        },
      },
      Thread: 'thread',
    },
  },
}

const tabIcon =
  (name) =>
  ({ color, size }) =>
    <Icon name={name} color={color} size={size} />

function stackScreens(theme) {
  return {
    headerStyle: { backgroundColor: theme.surface },
    headerTintColor: theme.text,
    headerTitleStyle: { fontSize: 16 },
    headerBackButtonDisplayMode: 'minimal',
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
    </Stack.Navigator>
  )
}

function SearchStack() {
  const theme = useEmberTheme()
  return (
    <Stack.Navigator screenOptions={stackScreens(theme)}>
      <Stack.Screen
        name="SearchTop"
        component={Search}
        options={{ title: '検索' }}
      />
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

function Tabs() {
  const theme = useEmberTheme()
  return (
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
        options={{ title: 'ホーム', tabBarIcon: tabIcon('home') }}
      />
      <Tab.Screen
        name="BoardTab"
        component={BoardStack}
        options={{ title: '板', tabBarIcon: tabIcon('boards') }}
      />
      <Tab.Screen
        name="SearchTab"
        component={SearchStack}
        options={{ title: '検索', tabBarIcon: tabIcon('search') }}
      />
      <Tab.Screen
        name="SettingsTab"
        component={SettingsStack}
        options={{ title: '設定', tabBarIcon: tabIcon('settings') }}
      />
    </Tab.Navigator>
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
      <NavigationContainer theme={navTheme} linking={linking}>
        <RootStack.Navigator screenOptions={stackScreens(theme)}>
          <RootStack.Screen
            name="Tabs"
            component={Tabs}
            options={{ headerShown: false }}
          />
          <RootStack.Screen
            name="Thread"
            component={Thread}
            options={{ headerBackAccessibilityLabel: '戻る' }}
          />
        </RootStack.Navigator>
      </NavigationContainer>
      <Toast />
    </>
  )
}
